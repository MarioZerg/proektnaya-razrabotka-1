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
import { fetchGazelkaPlansForSupply, type GazelkaPlan } from '@/lib/gazelkaApi';
import { driverAssigned, plateLabel } from '@/lib/gazelkaPlate';
import { updateSupply, type SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import { printGazelkaLabels } from '@/lib/gazelkaPackingLabel';
import { gazelkaLabelsHold, gazelkaShipDay, marketplaceSlotHold, noteOverdueSupply } from '@/lib/fboShipDate';

interface GazelkaShippingCardProps {
  supply: SupplyDetail;
  onReload: () => void;
  /** Менеджер (или админ): может выбирать заявку Газельки и синхронизировать данные. */
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
  const [allCount, setAllCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(supply.gazelkaPlanId ? String(supply.gazelkaPlanId) : '');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Дату сдачи в Газельку ставит менеджер: в API Газельки дня забора нет, а дата
  // рейса (route.date) с ним не совпадает — №1307 сдали 25.09, рейс стоял 27.09.
  const [shipAt, setShipAt] = useState((supply.shipToGazelkaAt ?? '').slice(0, 10));
  const [savingShipAt, setSavingShipAt] = useState(false);
  useEffect(() => {
    setShipAt((supply.shipToGazelkaAt ?? '').slice(0, 10));
  }, [supply.shipToGazelkaAt]);
  useEffect(() => {
    setLoading(true);
    fetchGazelkaPlansForSupply(supply.id)
      .then((r) => {
        setPlans(r.plans);
        setAllCount(r.allCount);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить заявки Газельки'))
      .finally(() => setLoading(false));
  }, [supply.id]);

  const linkedPlan = plans.find((p) => p.id === supply.gazelkaPlanId);
  const labelsHold =
    gazelkaLabelsHold(linkedPlan?.shipDate, supply.shipToGazelkaAt) ||
    marketplaceSlotHold(supply.id, supply.shipToGazelkaAt, supply.supplyDate, supply.timeslot);
  const labelDay = gazelkaShipDay(linkedPlan?.shipDate, supply.shipToGazelkaAt);
  if (labelDay) noteOverdueSupply(supply.id, labelDay);

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

  // Подтягивает данные привязанной заявки Газельки в поля поставки: ID отгрузки (№ заявки),
  // забор Газелькой (cargo_pickup) и количество коробов. Дату сдачи не трогаем.
  const handleSyncFromGazelka = async () => {
    if (!linkedPlan) return;
    setSyncing(true);
    try {
      await updateSupply(supply.id, {
        gazelkaId: String(linkedPlan.id),
        gazelkaPickup: !!linkedPlan.cargoPickup,
        packagingCount: linkedPlan.boxes ?? null,
      });
      toast({
        title: 'Данные из Газельки подтянуты',
        description: `ID отгрузки, забор и ${linkedPlan.boxes ?? 0} коробов обновлены.`,
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
      await updateSupply(supply.id, { shipToGazelkaAt: shipAt ? `${shipAt}T00:00:00` : '' });
      toast({ title: 'Дата сдачи в Газельку сохранена' });
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
              disabled={!linkedPlan || !!labelsHold}
            >
              <Icon name="Printer" size={14} className="mr-1.5" />
              <span className="sm:hidden">Стикеры</span>
              <span className="hidden sm:inline">Печать стикеров</span>
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {labelsHold && (
          <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <Icon name="TriangleAlert" size={15} className="mt-0.5 shrink-0" />
            {labelsHold}
          </p>
        )}
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
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      {allCount > 0
                        ? `Нет заявок в ${supply.cluster || 'этот город'}. Остальные ${allCount} — на другие склады или уже привязаны к другим поставкам`
                        : 'Нет заявок в Газельке'}
                    </div>
                  ) : (
                    plans.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        №{p.id} · {p.deliveryAddress || '—'} · {p.deliveryDate ? formatDate(p.deliveryDate) : ''} ·{' '}
                        {p.boxes ?? 0} кор. · {plateLabel(p.vehicleNumber)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {!loading && !error && allCount > plans.length && (
                <div className="w-full text-xs text-muted-foreground">
                  Показаны только заявки {supply.marketplace} в {supply.cluster || 'город поставки'} · скрыто{' '}
                  {allCount - plans.length} чужих
                </div>
              )}
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
                <span className="text-muted-foreground">Машина</span>
                {driverAssigned(linkedPlan.vehicleNumber) ? (
                  <span className="rounded border border-foreground px-1.5 font-mono font-bold">
                    {plateLabel(linkedPlan.vehicleNumber)}
                  </span>
                ) : (
                  <span className="font-medium text-amber-700">Водитель не назначен</span>
                )}
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Коробов / паллет</span>
                <span className="font-medium">
                  {linkedPlan.boxes ?? 0} / {linkedPlan.pallets ?? 0}
                </span>
              </div>
            </div>

            {/* Дату сдачи в Газельку ставит менеджер. Слот маркетплейса — только для
                чтения: система сама берёт его из заявки OZON каждые 10 минут. */}
            <div className="space-y-1.5 rounded-md bg-muted/40 p-3 text-xs">
              {isManager ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Сдача груза в Газельку</Label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      type="date"
                      className="h-8 w-full bg-background sm:w-44"
                      value={shipAt}
                      onChange={(e) => setShipAt(e.target.value)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSaveShipAt}
                      disabled={savingShipAt || shipAt === (supply.shipToGazelkaAt ?? '').slice(0, 10)}
                    >
                      {savingShipAt ? <Icon name="Loader2" size={14} className="animate-spin" /> : 'Сохранить'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Сдача груза в Газельку</span>
                  <span className="font-medium">
                    {supply.shipToGazelkaAt ? formatDate(supply.shipToGazelkaAt) : '—'}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Слот на маркетплейсе</span>
                <span className="font-medium">
                  {supply.supplyDate ? formatDate(supply.supplyDate) : '—'}
                  {supply.timeslot ? `, ${supply.timeslot}` : ''}
                </span>
              </div>
              <p className="text-muted-foreground">
                Слот подтягивается сам из {supply.marketplace === 'OZON' ? 'OZON' : 'маркетплейса'} — менять
                его нужно в кабинете площадки.
              </p>
            </div>

          </>
        )}
      </CardContent>
    </Card>
  );
};

export default GazelkaShippingCard;