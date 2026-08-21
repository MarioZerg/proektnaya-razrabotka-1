import { useCallback, useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import PriceAdviceTable from '@/components/crm/promotion/PriceAdviceTable';
import PromotionsList from '@/components/crm/promotion/PromotionsList';
import PricePushConfirm from '@/components/crm/promotion/PricePushConfirm';
import {
  decideAdvice,
  fetchOverview,
  fetchPromotions,
  pushPrices,
  saveStrategy,
  scorePromotions,
  syncPromotions,
  type MarketplaceCode,
  type OverviewResponse,
  type Promotion,
} from '@/lib/promotionApi';

const MARKETPLACES: { code: MarketplaceCode; label: string }[] = [
  { code: 'ozon', label: 'OZON' },
  { code: 'wildberries', label: 'Wildberries' },
  { code: 'yandex_market', label: 'Яндекс Маркет' },
];

/**
 * Продвижение: как вести цены к целевой марже и куда идти из акций.
 *
 * Цены меняются прямо отсюда — система отправляет их на площадку сама, и
 * ходить в кабинет больше не нужно. Но никогда по своей инициативе: только
 * после того, как владелец отметил позиции и подтвердил в отдельном окне.
 * Ошибка, разошедшаяся по восьмистам карточкам, стоит дороже, чем минута на
 * проверку списка.
 *
 * Цену двигаем мелкими шагами. Резкий подъём выбрасывает товар из скидки
 * площадки (СПП) и из выдачи — потерять позицию легко, вернуть трудно.
 */
const PromotionPage = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [marketplace, setMarketplace] = useState<MarketplaceCode>('ozon');
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);

  const [marginMin, setMarginMin] = useState('10');
  const [marginMax, setMarginMax] = useState('15');
  const [stepPercent, setStepPercent] = useState('2');
  const [stepDays, setStepDays] = useState('7');
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(() => {
    if (!isAdmin) return;
    setLoading(true);
    setSelected(new Set());
    fetchOverview(marketplace, user?.id)
      .then((d) => {
        setData(d);
        setMarginMin(String(d.strategy.marginMin));
        setMarginMax(String(d.strategy.marginMax));
        setStepPercent(String(d.strategy.stepPercent));
        setStepDays(String(d.strategy.stepDays));
      })
      .catch((e) => toast({ title: 'Не удалось загрузить', description: e.message }))
      .finally(() => setLoading(false));
  }, [marketplace, isAdmin, user?.id, toast]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (!isAdmin) return;
    fetchPromotions(user?.id).then(setPromos).catch(() => setPromos([]));
  }, [isAdmin, user?.id]);

  const toggle = (itemId: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  const actionable = (data?.items || []).filter(
    (i) => i.action === 'raise' || i.action === 'lower' || i.action === 'rollback',
  );

  const toggleAll = () =>
    setSelected((s) =>
      s.size === actionable.length ? new Set() : new Set(actionable.map((i) => i.itemId)),
    );

  const decide = async (decision: 'applied' | 'skipped') => {
    const items = actionable
      .filter((i) => selected.has(i.itemId))
      .map((i) => ({ ...i, marketplaceCode: marketplace }));
    if (items.length === 0) return;
    setBusy(true);
    try {
      await decideAdvice(items, decision, user?.id);
      toast({
        title: decision === 'applied' ? 'Отмечено как применённое' : 'Советы отклонены',
        description:
          decision === 'applied'
            ? `Позиций: ${items.length}. Не забудьте поменять цены в кабинете площадки`
            : `Позиций: ${items.length}`,
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const chosen = actionable.filter((i) => selected.has(i.itemId));

  /** Отправляет выбранные цены прямо на витрину площадки. */
  const handlePush = async () => {
    setBusy(true);
    try {
      const r = await pushPrices(
        marketplace,
        chosen.map((i) => ({ itemId: i.itemId, newPrice: i.suggestedPrice })),
        user?.id,
      );
      const problems = [...r.skipped, ...r.failed];
      toast({
        title: `Цены изменены: ${r.pushed}`,
        description: problems.length
          ? `Не отправлено ${problems.length}: ${problems[0].reason}`
          : 'Новые цены уже уходят на витрину',
        variant: r.pushed === 0 ? 'destructive' : undefined,
      });
      setPushOpen(false);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось изменить цены',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveStrategy = async () => {
    setBusy(true);
    try {
      await saveStrategy({
        marginMin: Number(marginMin) || 10,
        marginMax: Number(marginMax) || 15,
        stepPercent: Number(stepPercent) || 2,
        stepDays: Number(stepDays) || 7,
        actorId: user?.id,
      });
      toast({ title: 'Правила сохранены', description: 'Советы пересчитаны' });
      load();
    } finally {
      setBusy(false);
    }
  };

  const refreshPromos = async () => {
    setBusy(true);
    try {
      await syncPromotions(user?.id);
      await scorePromotions(user?.id);
      const list = await fetchPromotions(user?.id);
      setPromos(list);
      toast({ title: 'Акции обновлены', description: `Найдено: ${list.length}` });
    } catch (e) {
      toast({
        title: 'Не удалось обновить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <CrmLayout>
        <p className="text-sm text-muted-foreground">
          Раздел доступен администратору.
        </p>
      </CrmLayout>
    );
  }

  const s = data?.summary;

  return (
    <CrmLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Продвижение</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ведём маржу к цели мелкими шагами, чтобы не потерять скидку
              площадки. Отметьте позиции — и система сама изменит цены на
              витрине, в кабинет заходить не нужно.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowSettings((v) => !v)}>
              <Icon name="Settings" size={14} className="mr-1.5" />
              Правила
            </Button>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <Icon
                name={loading ? 'Loader2' : 'RefreshCw'}
                size={14}
                className={`mr-1.5 ${loading ? 'animate-spin' : ''}`}
              />
              Пересчитать
            </Button>
          </div>
        </div>

        {showSettings && (
          <Card className="border-border shadow-none">
            <CardContent className="space-y-3 pt-6">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>Маржа от, %</Label>
                  <Input
                    type="number"
                    value={marginMin}
                    onChange={(e) => setMarginMin(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Маржа до, %</Label>
                  <Input
                    type="number"
                    value={marginMax}
                    onChange={(e) => setMarginMax(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Шаг цены, %</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={stepPercent}
                    onChange={(e) => setStepPercent(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Мелкий шаг бережёт СПП
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Пауза, дней</Label>
                  <Input
                    type="number"
                    value={stepDays}
                    onChange={(e) => setStepDays(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Между шагами по одному товару
                  </p>
                </div>
              </div>
              <Button onClick={handleSaveStrategy} disabled={busy}>
                <Icon name="Check" size={16} className="mr-1.5" />
                Сохранить
              </Button>
            </CardContent>
          </Card>
        )}

        <Tabs value={marketplace} onValueChange={(v) => setMarketplace(v as MarketplaceCode)}>
          <TabsList>
            {MARKETPLACES.map((m) => (
              <TabsTrigger key={m.code} value={m.code}>
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {MARKETPLACES.map((m) => (
            <TabsContent key={m.code} value={m.code} className="space-y-4 pt-4">
              {s && (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">Поднять цену</p>
                    <p className="text-2xl font-bold text-emerald-700">{s.raise}</p>
                    <p className="text-xs text-muted-foreground">маржа ниже цели</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">Снизить цену</p>
                    <p className="text-2xl font-bold text-amber-700">{s.lower}</p>
                    <p className="text-xs text-muted-foreground">цена завышена</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">В норме</p>
                    <p className="text-2xl font-bold">{s.hold}</p>
                    <p className="text-xs text-muted-foreground">трогать не нужно</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">Реклама съедает</p>
                    <p className="text-2xl font-bold">{s.avgAdPercent ?? 0}%</p>
                    <p className="text-xs text-muted-foreground">от цены в среднем</p>
                  </div>
                </div>
              )}

              {/* Эти товары прибыльны сами по себе — их топит только реклама.
                  Поднимать им цену бесполезно: надо выключать бустинг. */}
              {!!s?.killedByAds && s.killedByAds > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <Icon
                    name="TriangleAlert"
                    size={16}
                    className="mt-0.5 shrink-0 text-amber-700"
                  />
                  <div className="text-sm">
                    <p className="font-medium text-amber-900">
                      {s.killedByAds} позиций убыточны только из-за рекламы
                    </p>
                    <p className="text-amber-800">
                      Без продвижения они были бы в плюсе. Поднимать цену тут
                      бесполезно — выгоднее отключить им рекламу в кабинете
                      площадки
                    </p>
                  </div>
                </div>
              )}

              {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
                  <span className="text-sm font-medium">Выбрано: {selected.size}</span>
                  {/* Главное действие: система сама меняет цену на витрине.
                      Раньше приходилось идти в кабинет площадки руками. */}
                  <Button size="sm" onClick={() => setPushOpen(true)} disabled={busy}>
                    <Icon name="Upload" size={14} className="mr-1.5" />
                    Изменить цены на площадке
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => decide('applied')}
                    disabled={busy}
                  >
                    <Icon name="Check" size={14} className="mr-1.5" />
                    Уже менял сам
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => decide('skipped')}
                    disabled={busy}
                  >
                    <Icon name="X" size={14} className="mr-1.5" />
                    Не буду менять
                  </Button>
                </div>
              )}

              {loading ? (
                <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                  <Icon name="Loader2" size={16} className="animate-spin" />
                  Считаем советы…
                </div>
              ) : (
                <PriceAdviceTable
                  items={data?.items || []}
                  selected={selected}
                  onToggle={toggle}
                  onToggleAll={toggleAll}
                />
              )}
            </TabsContent>
          ))}
        </Tabs>

        <PricePushConfirm
          open={pushOpen}
          onOpenChange={setPushOpen}
          items={chosen}
          marketplaceTitle={
            MARKETPLACES.find((m) => m.code === marketplace)?.label || ''
          }
          busy={busy}
          onConfirm={handlePush}
        />

        <div className="space-y-3 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Акции площадок</h2>
              <p className="text-xs text-muted-foreground">
                Что останется от заработка, если пойти в акцию по ценам площадки
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={refreshPromos} disabled={busy}>
              <Icon
                name={busy ? 'Loader2' : 'RefreshCw'}
                size={14}
                className={`mr-1.5 ${busy ? 'animate-spin' : ''}`}
              />
              Обновить акции
            </Button>
          </div>
          <PromotionsList items={promos} />
        </div>
      </div>
    </CrmLayout>
  );
};

export default PromotionPage;