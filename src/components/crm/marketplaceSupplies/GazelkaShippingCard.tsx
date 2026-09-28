import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { formatDate } from '@/lib/dateUtils';
import { fetchGazelkaPlans, type GazelkaPlan } from '@/lib/gazelkaApi';
import { updateSupply, type SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import { printGazelkaLabels, missingLabelFields } from '@/lib/gazelkaPackingLabel';

interface GazelkaShippingCardProps {
  supply: SupplyDetail;
  onReload: () => void;
  /** Менеджер (или админ): может выбирать заявку Газельки, синхронизировать данные, вводить коды. */
  isManager: boolean;
  /** Данные Газельки заполнены менеджером (выбрана заявка + синхронизирован ID отгрузки) —
   * только тогда кладовщику доступна печать стикеров. */
  gazelkaReady: boolean;
}

/** Грузоперевозка через Газельку: менеджер вручную выбирает заявку Газельки под поставку,
 * после чего можно распечатать упаковочные листы коробов — прямо в нашей системе (штрихкод
 * Code128). Лист печатаем сами: в API Газельки метода выдачи PDF нет, а её страница
 * print-labels отключена, так что внешнего источника маркировки у нас не осталось. */
const GazelkaShippingCard = ({ supply, onReload, isManager, gazelkaReady }: GazelkaShippingCardProps) => {
  const { toast } = useToast();
  const [plans, setPlans] = useState<GazelkaPlan[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(supply.gazelkaPlanId ? String(supply.gazelkaPlanId) : '');
  const [saving, setSaving] = useState(false);
  const [ids, setIds] = useState(String(supply.gazelkaIds ?? 0));
  const [idm, setIdm] = useState(String(supply.gazelkaIdm ?? 0));
  const [savingIds, setSavingIds] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Дата отгрузки: Газелька присылает её не всегда (блок route в ответе бывает пуст),
  // поэтому менеджер должен иметь возможность проставить её руками — иначе на этикетке
  // в строке «Дата отгрузки» остаётся прочерк.
  const [shipAt, setShipAt] = useState((supply.shipToGazelkaAt ?? '').slice(0, 10));
  const [savingShipAt, setSavingShipAt] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchGazelkaPlans()
      .then(setPlans)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить заявки Газельки'))
      .finally(() => setLoading(false));
  }, []);

  const linkedPlan = plans.find((p) => p.id === supply.gazelkaPlanId);

  // Чего не хватает для печати листов. Считаем здесь же, чтобы менеджер видел
  // недостающее рядом с полями, которые он и заполняет.
  const missing = linkedPlan
    ? missingLabelFields({
        plan: linkedPlan,
        supply,
        boxesCount: linkedPlan.boxes || supply.boxes.length || 1,
      })
    : [];

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSupply(supply.id, { gazelkaPlanId: selected ? Number(selected) : null });
      toast({ title: selected ? 'Заявка Газельки привязана' : 'Заявка Газельки отвязана' });
      onReload();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveIds = async () => {
    setSavingIds(true);
    try {
      await updateSupply(supply.id, { gazelkaIds: Number(ids) || 0, gazelkaIdm: Number(idm) || 0 });
      toast({ title: 'Коды склада сохранены' });
      onReload();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSavingIds(false);
    }
  };

  // Подтягивает данные привязанной заявки Газельки в поля поставки: ID отгрузки (№ заявки),
  // дату отгрузки (route.date), забор Газелькой (cargo_pickup) и количество коробов.
  const handleSyncFromGazelka = async () => {
    if (!linkedPlan) return;
    setSyncing(true);
    try {
      // ДАТУ ОТГРУЗКИ НЕ ЗАТИРАЕМ, ЕСЛИ ГАЗЕЛЬКА ЕЁ НЕ ПРИСЛАЛА.
      //
      // shipDate лежит в блоке route, а его API отдаёт не всегда. Раньше в таком
      // случае сюда уходила пустая строка — и синхронизация СТИРАЛА дату, которую
      // менеджер проставил руками. Получался тупик: на этикетке вечный прочерк,
      // сколько ни нажимай «Синхронизировать».
      const shipAt = linkedPlan.shipDate
        ? `${linkedPlan.shipDate.slice(0, 10)}T00:00:00`
        : undefined;
      await updateSupply(supply.id, {
        gazelkaId: String(linkedPlan.id),
        ...(shipAt ? { shipToGazelkaAt: shipAt } : {}),
        gazelkaPickup: !!linkedPlan.cargoPickup,
        packagingCount: linkedPlan.boxes ?? null,
      });
      // Про дату пишем только когда она реально пришла: иначе сообщение обещало
      // «дата обновлена», менеджер шёл печатать — а там прочерк.
      toast({
        title: 'Данные из Газельки подтянуты',
        description: shipAt
          ? `ID отгрузки, дата, забор и ${linkedPlan.boxes ?? 0} коробов обновлены.`
          : `ID отгрузки, забор и ${linkedPlan.boxes ?? 0} коробов обновлены. `
            + 'Дату отгрузки Газелька не прислала — проставьте её в поле «Отгрузка в Газельку».',
      });
      onReload();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveShipAt = async () => {
    setSavingShipAt(true);
    try {
      await updateSupply(supply.id, {
        shipToGazelkaAt: shipAt ? `${shipAt}T00:00:00` : '',
      });
      toast({ title: shipAt ? 'Дата отгрузки сохранена' : 'Дата отгрузки очищена' });
      onReload();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSavingShipAt(false);
    }
  };

  const handlePrintOurLabels = async () => {
    if (!linkedPlan) return;
    const boxesCount = linkedPlan.boxes || supply.boxes.length || 1;
    try {
      // Коды рисуются асинхронно — без await ошибка ушла бы в пустоту, и на принтер
      // отправились бы листы без кодов.
      await printGazelkaLabels({ plan: linkedPlan, supply, boxesCount });
    } catch (e) {
      toast({
        title: 'Не удалось напечатать листы',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">Газелька</CardTitle>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {/* Синхронизация — только менеджер */}
          {isManager && supply.gazelkaPlanId && (
            <Button size="sm" variant="secondary" className="w-full" onClick={handleSyncFromGazelka} disabled={syncing || !linkedPlan}>
              <Icon
                name={syncing ? 'Loader2' : 'RefreshCw'}
                size={14}
                className={`mr-1.5 ${syncing ? 'animate-spin' : ''}`}
              />
              <span className="sm:hidden">{syncing ? 'Синхр…' : 'Синхронизация'}</span>
              <span className="hidden sm:inline">{syncing ? 'Синхронизация…' : 'Синхронизировать данные'}</span>
            </Button>
          )}
          {/* Печать стикеров — доступна только после того, как менеджер синхронизировал данные.
              Кнопки «В ЛК Газельки» больше нет: адрес print-labels у сервиса отключён (404),
              а неработающая ссылка на складе опаснее её отсутствия — кладовщик жмёт её,
              получает пустую страницу и уходит отгружать короба без маркировки. */}
          {gazelkaReady && supply.gazelkaPlanId && (
            <Button
              size="sm"
              className="w-full bg-[#004cdb] text-white hover:bg-[#003bb0]"
              onClick={handlePrintOurLabels}
              disabled={!linkedPlan || missing.length > 0}
              title={
                missing.length > 0
                  ? `Не заполнено: ${missing.join(', ')}`
                  : undefined
              }
            >
              <Icon name="Printer" size={14} className="mr-1.5" />
              <span className="sm:hidden">Стикеры</span>
              <span className="hidden sm:inline">Печать стикеров</span>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Выбор заявки Газельки — только менеджер */}
        {isManager && (
          <div className="space-y-1.5">
            <Label>Заявка Газельки для этой поставки</Label>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Select value={selected} onValueChange={setSelected} disabled={loading}>
                <SelectTrigger className="w-full min-w-0 sm:w-[360px]">
                  <SelectValue placeholder={loading ? 'Загрузка заявок Газельки...' : '— Выберите заявку —'} />
                </SelectTrigger>
                <SelectContent>
                  {error ? (
                    <div className="px-2 py-1.5 text-sm text-destructive">{error}</div>
                  ) : plans.length === 0 && !loading ? (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет заявок в Газельке</div>
                  ) : (
                    plans.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        №{p.id} · {p.deliveryAddress || '—'} · {p.deliveryDate ? formatDate(p.deliveryDate) : ''} ·{' '}
                        {p.boxes ?? 0} кор.
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                className="w-full sm:w-auto"
                onClick={handleSave}
                disabled={saving || String(supply.gazelkaPlanId ?? '') === selected}
              >
                {saving ? <Icon name="Loader2" size={14} className="animate-spin" /> : 'Сохранить'}
              </Button>
            </div>
            <p className="text-xs leading-snug text-muted-foreground">
              <span className="sm:hidden">Сохраните заявку и синхронизируйте — появятся стикеры.</span>
              <span className="hidden sm:inline">
                Выберите заявку и нажмите «Синхронизировать данные» — после этого кладовщику станут доступны
                печать стикеров коробов.
              </span>
            </p>
          </div>
        )}

        {/* Кладовщику, пока менеджер не подготовил данные — понятная подсказка */}
        {!isManager && !gazelkaReady && (
          <p className="text-sm text-muted-foreground">
            Стикеры коробов появятся, когда менеджер выберет заявку Газельки и синхронизирует данные.
          </p>
        )}

        {linkedPlan && (
          <>
            <div className="space-y-1 rounded-md bg-muted/40 p-3 text-xs">
              <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-muted-foreground">Статус Газельки</span>
                <Badge variant="secondary">{linkedPlan.statusLabel}</Badge>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
                <span className="text-muted-foreground">Склад / адрес</span>
                <span className="break-words font-medium">{linkedPlan.deliveryAddress || '—'}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Дата доставки</span>
                <span className="font-medium">
                  {linkedPlan.deliveryDate ? formatDate(linkedPlan.deliveryDate) : '—'}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Коробов / паллет</span>
                <span className="font-medium">
                  {linkedPlan.boxes ?? 0} / {linkedPlan.pallets ?? 0}
                </span>
              </div>
            </div>

            {/* ЧЕГО НЕ ХВАТАЕТ ДЛЯ ПЕЧАТИ.
                Показываем списком у полей, которые менеджер и заполняет: иначе он
                видит серую кнопку печати и не понимает, чего от него хотят. */}
            {missing.length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="flex items-center gap-1.5 font-medium">
                  <Icon name="CircleAlert" size={13} className="shrink-0" />
                  Печать листов закрыта — не заполнено:
                </p>
                <ul className="ml-5 list-disc space-y-0.5">
                  {missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* ДАТА ОТГРУЗКИ — РУЧНОЕ ПОЛЕ.
                Газелька отдаёт её в блоке route, которого в ответе часто нет. Без
                ручного ввода на этикетке в строке «Дата отгрузки» оставался прочерк,
                и исправить это было нечем — синхронизация тянула то же пустое поле. */}
            {isManager && (
              <div className="space-y-1.5">
                <Label className="text-xs leading-snug">
                  Дата отгрузки
                  {!linkedPlan.shipDate && (
                    <span className="block font-normal text-muted-foreground">
                      Газелька не прислала — проставьте вручную
                    </span>
                  )}
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <Input
                    type="date"
                    className="w-full sm:w-44"
                    value={shipAt}
                    onChange={(e) => setShipAt(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={handleSaveShipAt}
                    disabled={savingShipAt || shipAt === (supply.shipToGazelkaAt ?? '').slice(0, 10)}
                  >
                    {savingShipAt ? <Icon name="Loader2" size={14} className="animate-spin" /> : 'Сохранить дату'}
                  </Button>
                </div>
              </div>
            )}

            {/* Коды склада для штрихкода — редактирует только менеджер */}
            {isManager && (
              <div className="space-y-1.5">
                <Label className="text-xs leading-snug">
                  Код склада (IDS)
                  <span className="hidden font-normal text-muted-foreground sm:inline">
                    {' '}
                    — единственное, чего нет в API Газельки
                  </span>
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    className="w-24"
                    value={ids}
                    onChange={(e) => setIds(e.target.value)}
                    placeholder="IDS"
                  />
                  {/* IDM подставляется сам из заявки (marketplace_id), поле нужно только
                      на случай, когда Газелька просит другой код — тогда ввод главнее. */}
                  <Input
                    type="number"
                    className="w-24"
                    value={idm}
                    onChange={(e) => setIdm(e.target.value)}
                    placeholder={linkedPlan?.marketplaceId ? `IDM (авто: ${linkedPlan.marketplaceId})` : 'IDM'}
                  />
                  <Button
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={handleSaveIds}
                    disabled={savingIds || (Number(ids) === supply.gazelkaIds && Number(idm) === supply.gazelkaIdm)}
                  >
                    {savingIds ? <Icon name="Loader2" size={14} className="animate-spin" /> : 'Сохранить коды'}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default GazelkaShippingCard;