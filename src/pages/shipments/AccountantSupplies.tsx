import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  accountantConfirmSupply,
  accountantCorrectionSupply,
  fetchShipmentDetail,
  fetchShipments,
  type Shipment,
} from '@/lib/shipmentsApi';
import { printAcceptanceSheet } from '@/lib/printAcceptanceSheet';
import { formatDate } from '@/lib/dateUtils';
import { formatQuantity } from '@/lib/formatQuantity';
import {
  accountantStatusLabel,
  accountantStatusVariant,
} from '@/components/crm/shipments/fromSupplierShared';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

/**
 * Сверка листов приёмки: бухгалтер подтверждает — поставка уходит в 1С,
 * или возвращает кладовщику с причиной.
 */
const AccountantSupplies = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const canConfirm = user?.role === 'accountant' || user?.role === 'admin';

  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [tab, setTab] = useState<'pending' | 'correction' | 'confirmed'>('pending');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [correctionId, setCorrectionId] = useState<number | null>(null);
  const [correctionText, setCorrectionText] = useState('');

  const load = () => {
    setLoading(true);
    fetchShipments({ type: 'from_supplier', accountantStatus: tab })
      .then((list) => {
        setListError(null);
        setShipments(list);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить приёмки');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const printSheet = async (id: number) => {
    try {
      const detail = await fetchShipmentDetail(id);
      printAcceptanceSheet(detail);
    } catch (e) {
      toast({
        title: 'Не удалось напечатать лист',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const confirm = async (id: number) => {
    setBusyId(id);
    try {
      const res = await accountantConfirmSupply(id);
      const onec = res.onec;
      toast({
        title: 'Приёмка подтверждена',
        description:
          onec?.sent
            ? 'Документ ушёл в 1С'
            : onec?.error || 'Документ в очереди на отправку в 1С',
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось подтвердить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const sendCorrection = async () => {
    if (!correctionId || !correctionText.trim()) return;
    setBusyId(correctionId);
    try {
      await accountantCorrectionSupply(correctionId, correctionText.trim());
      toast({ title: 'Отправлено кладовщику на корректировку' });
      setCorrectionId(null);
      setCorrectionText('');
      load();
    } catch (e) {
      toast({
        title: 'Не удалось вернуть',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <CrmLayout>
      <div className="min-w-0 space-y-6 overflow-x-hidden">
        <div>
          <h1 className="text-xl font-bold">Приёмки от поставщика</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Сверьте лист приёмки с количеством в системе. Подтверждение отправляет поставку в 1С.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              ['pending', 'Ждут сверки'],
              ['correction', 'На корректировке'],
              ['confirmed', 'Подтверждены'],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              size="sm"
              variant={tab === id ? 'default' : 'outline'}
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </div>

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить приёмки"
            description={listError}
            onRetry={load}
          />
        )}

        {loading && shipments.length === 0 && (
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        )}

        {!loading && shipments.length === 0 && !listError && (
          <p className="text-sm text-muted-foreground">
            {tab === 'pending' ? 'Нет приёмок на сверке' : 'Список пуст'}
          </p>
        )}

        <div className="space-y-3">
          {shipments.map((s) => (
            <article key={s.id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold">Приёмка #{s.id}</h2>
                  {s.accountantStatus && (
                    <Badge variant={accountantStatusVariant[s.accountantStatus] || 'outline'}>
                      {accountantStatusLabel[s.accountantStatus] || s.accountantStatus}
                    </Badge>
                  )}
                </div>
                <p className="text-sm">{s.itemSuppliers || s.supplierName || '—'}</p>
                <p className="text-sm text-muted-foreground">
                  {s.itemsCount} поз. · {formatQuantity(s.totalQuantity)} метр/шт
                  {s.createdByName ? ` · ${s.createdByName}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">Создана {formatDate(s.createdAt)}</p>
                {s.accountantComment && (
                  <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    Причина: {s.accountantComment}
                  </p>
                )}
                {s.onecError && (
                  <p className="text-xs text-destructive">1С: {s.onecError}</p>
                )}
                {s.onecSyncedAt && (
                  <p className="text-xs text-muted-foreground">Ушло в 1С {formatDate(s.onecSyncedAt)}</p>
                )}

                {correctionId === s.id ? (
                  <div className="space-y-2">
                    <Textarea
                      placeholder="Что исправить в приёмке"
                      value={correctionText}
                      onChange={(e) => setCorrectionText(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={sendCorrection} disabled={busyId === s.id || !correctionText.trim()}>
                        Отправить кладовщику
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setCorrectionId(null)}>
                        Отмена
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => printSheet(s.id)}>
                      <Icon name="FileText" size={14} className="mr-1.5" />
                      Лист
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/crm/shipments/from-supplier/${s.id}`)}
                    >
                      <Icon name="Layers" size={14} className="mr-1.5" />
                      Позиции
                    </Button>
                    {canConfirm && s.accountantStatus !== 'confirmed' && (
                      <>
                        <Button size="sm" onClick={() => confirm(s.id)} disabled={busyId === s.id}>
                          <Icon name="ClipboardCheck" size={14} className="mr-1.5" />
                          Подтвердить в 1С
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setCorrectionId(s.id);
                            setCorrectionText('');
                          }}
                        >
                          На корректировку
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </CrmLayout>
  );
};

export default AccountantSupplies;
