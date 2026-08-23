import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  fetchPromotions,
  fetchActionCandidates,
  joinAction,
  type Promotion,
  type ActionCandidate,
} from '@/lib/promotionApi';
import { money } from './economicsShared';
import PromotePlan from './PromotePlan';

/**
 * Заведение товаров в акцию площадки.
 *
 * Площадка зовёт в акцию списком на сотни позиций и обещает продвижение, но
 * требует срезать цену. Вручную проверить каждую вещь невозможно — и так
 * товары уходят в акцию себе в убыток.
 *
 * Здесь по каждому кандидату сразу посчитана прибыль по цене акции: с
 * комиссией, логистикой, рекламой, налогом и себестоимостью. Убыточные
 * выбрать нельзя — ни здесь, ни через сервер.
 */
interface Props {
  /** Артикулы товаров карточки: их и предлагаем завести. */
  offerIds: string[];
  /** Название для заголовка. */
  title: string;
  /** Материал целиком — для плана по всем размерам сразу. */
  material?: string;
}

const PromoteDialog = ({ offerIds, title, material }: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [actionId, setActionId] = useState('');
  const [minMargin, setMinMargin] = useState('5');
  // Насколько уйти ниже потолка площадки. Ноль — цена по потолку, то есть
  // минимум скидки: запас прибыли остаётся на другие акции.
  const [extra, setExtra] = useState('0');
  const [items, setItems] = useState<ActionCandidate[]>([]);
  // Сводка по занятости: сколько мест в акциях осталось.
  const [quota, setQuota] = useState<{
    busyShort?: number;
    limitItems?: number;
    totalItems?: number;
  }>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // План по материалу — вкладка по умолчанию: решение о скидках принимается
  // по материалу целиком, а не по одной ширине.
  const [tab, setTab] = useState<'plan' | 'single'>(
    material ? 'plan' : 'single',
  );

  useEffect(() => {
    if (!open) return;
    fetchPromotions(user?.id)
      .then((p) => setPromos(p.filter((x) => x.marketplaceCode === 'ozon')))
      .catch(() => setPromos([]));
  }, [open, user?.id]);

  // Кандидаты пересчитываются при смене акции или порога прибыли.
  useEffect(() => {
    if (!actionId) {
      setItems([]);
      return;
    }
    setLoading(true);
    fetchActionCandidates(
      actionId, user?.id, Number(minMargin) || 0, Number(extra) || 0,
    )
      .then((d) => {
        setItems(d.items);
        setQuota({
          busyShort: d.busyShort,
          limitItems: d.limitItems,
          totalItems: d.totalItems,
        });
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [actionId, minMargin, extra, user?.id]);

  // Только наши размеры: карточка отвечает за свою ткань и ширину.
  const mine = items.filter((i) => offerIds.includes(i.offerId));
  const good = mine.filter((i) => i.eligible);
  const bad = mine.filter((i) => !i.eligible);

  const submit = async () => {
    setSaving(true);
    try {
      const res = await joinAction({
        actionId,
        offerIds: good.map((i) => i.offerId),
        minMargin: Number(minMargin) || 0,
        extraDiscount: Number(extra) || 0,
        actorId: user?.id,
        actorName: user?.name,
      });
      toast({
        title: 'Заведено в акцию',
        description: `${res.joined} товаров. Отклонено по прибыли: ${
          res.rejected?.length || 0
        }`,
      });
      setOpen(false);
    } catch (e) {
      toast({
        title: 'Не удалось завести',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs">
          <Icon name="Megaphone" size={13} className="mr-1" />
          Продвигать
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Продвижение · {title}</DialogTitle>
        </DialogHeader>
        {/* Две задачи в одном окне.
            План — стратегия по материалу: во что входить и в какой
            очерёдности, чтобы средняя маржа не просела.
            Одна акция — точечное решение по конкретной ширине. */}
        {!!material && (
          <div className="flex gap-1 rounded-md bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setTab('plan')}
              className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
                tab === 'plan' ? 'bg-background shadow-sm' : 'text-muted-foreground'
              }`}
            >
              План по материалу
            </button>
            <button
              type="button"
              onClick={() => setTab('single')}
              className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
                tab === 'single' ? 'bg-background shadow-sm' : 'text-muted-foreground'
              }`}
            >
              Одна акция
            </button>
          </div>
        )}

        {tab === 'plan' && !!material ? (
          <PromotePlan material={material} onDone={() => setOpen(false)} />
        ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Акция площадки</Label>
            <Select value={actionId} onValueChange={setActionId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите акцию" />
              </SelectTrigger>
              <SelectContent>
                {promos.map((p) => (
                  <SelectItem key={p.externalId} value={String(p.externalId)}>
                    {p.title}
                    {p.avgMargin != null && ` · маржа ${p.avgMargin}%`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Минимальная маржа, %</Label>
            <Input
              type="number"
              value={minMargin}
              onChange={(e) => setMinMargin(e.target.value)}
              className="h-9"
            />
            <p className="text-xs text-muted-foreground">
              Товары с меньшей прибылью в акцию не пойдут. Запас нужен: цена
              может просесть ещё и от скидки покупателю
            </p>
          </div>

          {/* Занятость акциями. Без неё непонятно, почему прибыльный товар
              «не проходит»: место в акциях ограничено намеренно — часть
              ассортимента бережём для следующих хороших предложений. */}
          {!loading && !!actionId && quota.limitItems != null && (
            <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
              В срочных акциях сейчас {quota.busyShort} товаров из{' '}
              {quota.limitItems} разрешённых (каталог — {quota.totalItems}).
              Остальное бережём для следующих акций
            </p>
          )}

          {/* Глубина скидки. Площадка называет потолок цены — минимум, какой
              она примет. Ноль значит «войти по потолку»: отдаём минимум
              скидки и бережём запас прибыли для других акций. */}
          <div className="space-y-1.5">
            <Label>Скидка сверх минимума площадки, %</Label>
            <Input
              type="number"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              className="h-9"
            />
            <p className="text-xs text-muted-foreground">
              Ноль — заходим по цене площадки, отдавая минимум скидки. Больше
              скидка — выше буст в выдаче, но меньше прибыль
            </p>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon name="Loader2" size={14} className="animate-spin" />
              Считаем прибыль по цене акции…
            </div>
          )}

          {!loading && !!actionId && (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {mine.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Площадка не предлагает эти размеры в выбранную акцию
                </p>
              )}
              {good.map((i) => (
                <div
                  key={i.offerId}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="min-w-0 truncate">{i.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-muted-foreground">
                      {money(i.currentPrice)} → {money(i.actionPrice)} ₽
                    </span>
                    <span className="font-semibold text-emerald-700">
                      +{money(i.profit)} ₽ ({i.margin}%)
                    </span>
                  </span>
                </div>
              ))}
              {/* Отклонённые показываем с причиной: иначе непонятно, почему
                  часть размеров в акцию не пошла. */}
              {bad.map((i) => (
                <div
                  key={i.offerId}
                  className="flex items-center justify-between gap-2 text-xs text-muted-foreground line-through"
                >
                  <span className="min-w-0 truncate">{i.name}</span>
                  <span className="shrink-0 no-underline">{i.reason}</span>
                </div>
              ))}
            </div>
          )}

          <Button
            className="w-full"
            onClick={submit}
            disabled={saving || good.length === 0}
          >
            {saving
              ? 'Заводим…'
              : `Завести в акцию ${good.length > 0 ? `(${good.length})` : ''}`}
          </Button>
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PromoteDialog;
