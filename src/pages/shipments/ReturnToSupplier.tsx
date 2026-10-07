import { useEffect, useRef, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import { useSubmitGuard, useIdSubmitGuard } from '@/hooks/useSubmitGuard';
import {
  approveReturnToSupplier,
  deleteShipment,
  fetchShipmentDetail,
  fetchShipments,
  removeReturnItem,
  scanReturnToSupplier,
  updateReturnItemQuantity,
  type Shipment,
  type ShipmentDetail,
  type ShipmentItem,
} from '@/lib/shipmentsApi';
import { formatDateTime as formatDate } from '@/lib/dateUtils';
import { formatQuantity } from '@/lib/formatQuantity';
import {
  moneyAmount,
  moneyRub,
  statusVariant,
} from '@/components/crm/shipments/fromSupplierShared';
import { printReturnToSupplierSheet } from '@/lib/printReturnToSupplierSheet';
import { playScanSound, playScanErrorSound, primeScanSounds } from '@/lib/scanSound';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import ReturnToSupplierScanner from '@/components/crm/shipments/ReturnToSupplierScanner';
import ReturnConfirmDialog from '@/components/crm/shipments/ReturnConfirmDialog';

const itemPrice = (item: ShipmentItem) =>
  item.price ?? item.rollPurchasePrice ?? null;

const itemSum = (item: ShipmentItem) => {
  const price = itemPrice(item);
  if (price == null) return null;
  return price * Number(item.quantity || 0);
};

const ReturnToSupplier = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const canScan = isAdmin || isStorekeeperRole(user?.role);

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [drafts, setDrafts] = useState<ShipmentDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [scanCode, setScanCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const { busy: confirming, run: runConfirm } = useSubmitGuard();
  const { busyId, run: runRow } = useIdSubmitGuard();

  const [confirmId, setConfirmId] = useState<number | null>(null);

  const focusScan = () => setTimeout(() => scanInputRef.current?.focus(), 0);

  const load = () => {
    setLoading(true);
    fetchShipments('return_to_supplier')
      .then(async (list) => {
        setListError(null);
        setShipments(list);
        const open = list.filter((s) => s.status === 'Новый');
        const details = await Promise.all(
          open.map((s) => fetchShipmentDetail(s.id).catch(() => null))
        );
        setDrafts(details.filter((d): d is ShipmentDetail => Boolean(d)));
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить возвраты');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    primeScanSounds();
    load();
  }, []);

  const doneShipments = shipments.filter((s) => s.status !== 'Новый');
  const confirmDetail = drafts.find((d) => d.id === confirmId) || null;
  const activeDraft = drafts[0] || null;

  const handleScan = async () => {
    const code = scanCode.trim();
    if (!code || scanning || !canScan) return;
    setScanCode('');
    setScanning(true);
    try {
      const res = await scanReturnToSupplier(code);
      playScanSound();
      toast({
        title: `${res.item.rollBarcode} · ${res.item.materialName || 'материал'}`,
        description:
          res.item.price != null
            ? `${res.supplierName || 'Поставщик'}${res.item.originShipmentId ? ` · приёмка #${res.item.originShipmentId}` : ''} · ${moneyAmount(res.item.price, res.item.currency)} из приёмки`
            : `${res.supplierName || 'Поставщик'} · на рулоне нет цены приёмки`,
      });
      load();
    } catch (e) {
      playScanErrorSound();
      toast({
        title: 'Рулон не принят',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setScanning(false);
      focusScan();
    }
  };

  const handleQtyBlur = (item: ShipmentItem, raw: string) => {
    const qty = Number(String(raw).replace(',', '.'));
    if (!item.id || !Number.isFinite(qty) || qty === Number(item.quantity)) return;
    void runRow(item.id, async () => {
      try {
        await updateReturnItemQuantity(item.id, qty);
        load();
      } catch (e) {
        toast({
          title: 'Не удалось поправить метраж',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
        load();
      }
    });
  };

  const handleRemove = (itemId: number) => {
    void runRow(itemId, async () => {
      try {
        await removeReturnItem(itemId);
        load();
      } catch (e) {
        toast({
          title: 'Не удалось убрать рулон',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    });
  };

  const handleDeleteDraft = (id: number) => {
    void runRow(id, async () => {
      try {
        await deleteShipment(id);
        toast({ title: 'Черновик возврата удалён' });
        load();
      } catch (e) {
        toast({
          title: 'Не удалось удалить',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    });
  };

  const handleConfirm = (payload: {
    ourLogistics: boolean;
    logisticsCost?: number;
    comment?: string;
  }) => {
    if (!confirmId) return;
    if (payload.ourLogistics && !(payload.logisticsCost && payload.logisticsCost > 0)) {
      toast({
        title: 'Укажите стоимость логистики',
        variant: 'destructive',
      });
      return;
    }
    void runConfirm(async () => {
      try {
        await approveReturnToSupplier(confirmId, payload);
        toast({ title: 'Возврат подтверждён — напечатайте лист для бухгалтера' });
        const detail = await fetchShipmentDetail(confirmId);
        printReturnToSupplierSheet(detail);
        setConfirmId(null);
        load();
      } catch (e) {
        toast({
          title: 'Не удалось подтвердить',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    });
  };

  const handlePrint = async (id: number) => {
    try {
      const detail = await fetchShipmentDetail(id);
      printReturnToSupplierSheet(detail);
    } catch (e) {
      toast({
        title: 'Не удалось напечатать лист',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Возврат поставщику</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Отсканируйте рулон с браком. Цена — та, что зафиксировали на нём
            в приёмке. Рулоны одной поставки собираются в один возврат.
          </p>
        </div>

        {canScan && (
          <ReturnToSupplierScanner
            scanCode={scanCode}
            setScanCode={setScanCode}
            scanning={scanning}
            scanInputRef={scanInputRef}
            onScan={handleScan}
            supplierHint={activeDraft?.supplierName}
          />
        )}

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить возвраты"
            description={listError}
            onRetry={load}
          />
        )}

        {drafts.map((draft) => {
          const items = draft.items.filter((item) => item.rollId && !item.removedAt);
          return (
            <Card key={draft.id} className="shadow-none">
              <CardContent className="space-y-4 pt-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold">Черновик #{draft.id}</h2>
                      <Badge variant="secondary">Ждёт подтверждения</Badge>
                    </div>
                    <p className="mt-1 text-sm text-foreground">
                      {draft.supplierName || 'Поставщик не указан'}
                      {draft.originShipmentId ? ` · приёмка #${draft.originShipmentId}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {items.length} рул.
                      {draft.createdByName ? ` · ${draft.createdByName}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {isAdmin && (
                      <Button size="sm" onClick={() => setConfirmId(draft.id)} disabled={items.length === 0}>
                        <Icon name="ClipboardCheck" size={14} className="mr-1.5" />
                        Подтвердить
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDeleteDraft(draft.id)}
                      disabled={busyId === draft.id}
                    >
                      <Icon name="Trash2" size={14} className="mr-1.5" />
                      Удалить
                    </Button>
                  </div>
                </div>

                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Отсканируйте рулон — он появится здесь</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((item) => {
                      const price = itemPrice(item);
                      const sum = itemSum(item);
                      const currency = item.currency || item.supplierCurrency;
                      return (
                        <div
                          key={item.id}
                          className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2 sm:flex-row sm:items-center"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-mono-tech text-sm font-medium">{item.rollBarcode}</p>
                            <p className="text-sm text-muted-foreground">{item.materialName}</p>
                            <p className="text-xs text-muted-foreground">
                              {price != null
                                ? `${moneyAmount(price, currency)} за ${item.unit || 'ед.'} · из приёмки${item.originShipmentId ? ` #${item.originShipmentId}` : ''}`
                                : 'На рулоне нет цены из приёмки'}
                              {sum != null ? ` · ${moneyAmount(sum, currency)}` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              defaultValue={item.quantity ?? ''}
                              className="w-24"
                              disabled={busyId === item.id}
                              onBlur={(e) => handleQtyBlur(item, e.target.value)}
                            />
                            <span className="w-10 text-xs text-muted-foreground">{item.unit || ''}</span>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              disabled={busyId === item.id}
                              onClick={() => handleRemove(item.id)}
                            >
                              <Icon name="Trash2" size={16} />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!isAdmin && items.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Дальше подтверждает администратор. После этого напечатайте лист и отнесите бухгалтеру.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}

        {loading && shipments.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : doneShipments.length === 0 && drafts.length === 0 ? (
          listError ? null : (
            <p className="text-sm text-muted-foreground">
              Возвратов пока нет. Отсканируйте рулон, чтобы собрать первый документ.
            </p>
          )
        ) : doneShipments.length > 0 ? (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">Подтверждённые</h2>
            {doneShipments.map((s) => (
              <article key={s.id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold">Возврат #{s.id}</h3>
                  <Badge variant={statusVariant[s.status] || 'secondary'}>{s.status}</Badge>
                </div>
                <p className="mt-2 text-sm text-foreground">
                  {s.supplierName || '—'}
                  {s.originShipmentId ? ` · приёмка #${s.originShipmentId}` : ''}
                </p>
                <p className="text-sm text-muted-foreground">
                  {s.itemsCount} поз. · {formatQuantity(s.totalQuantity)} метр/шт
                  {s.createdByName ? ` · ${s.createdByName}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  Создан {formatDate(s.createdAt)}
                  {s.completedAt ? ` · подтверждён ${formatDate(s.completedAt)}` : ''}
                </p>
                {(s.logisticsCost || 0) > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Логистика за наш счёт: {moneyRub(s.logisticsCost || 0)}
                  </p>
                )}
                {s.comment && <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{s.comment}</p>}
                <div className="mt-3">
                  <Button size="sm" variant="outline" onClick={() => handlePrint(s.id)}>
                    <Icon name="Printer" size={14} className="mr-1.5" />
                    Лист для бухгалтера
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      <ReturnConfirmDialog
        open={confirmId != null}
        detail={confirmDetail}
        busy={confirming}
        onClose={() => setConfirmId(null)}
        onConfirm={handleConfirm}
      />
    </CrmLayout>
  );
};

export default ReturnToSupplier;
