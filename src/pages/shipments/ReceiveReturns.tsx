import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { printBarcodes } from '@/lib/printBarcodes';
import {
  fetchMarketplaceReturns,
  syncMarketplaceReturns,
  receiveMarketplaceReturn,
  rejectMarketplaceReturn,
  type MarketplaceReturn,
} from '@/lib/marketplaceReturnsApi';

const statusLabels: Record<string, { label: string; className: string }> = {
  new: { label: 'Ждёт приёмки', className: 'bg-amber-500 text-white hover:bg-amber-500' },
  received: { label: 'Принят на склад', className: 'bg-emerald-600 text-white hover:bg-emerald-600' },
  rejected: { label: 'Не приехал', className: '' },
};

const marketplaceClass: Record<string, string> = {
  OZON: 'text-[#005BFF] font-bold',
  WB: 'text-[#CB11AB] font-bold',
};

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

/** Возвраты с маркетплейсов: система сама тянет заявки с OZON и WB, кладовщик отмечает,
 * что коробка доехала, и вещь встаёт на склад в очередь «Ждёт полку». */
const ReceiveReturns = () => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [returns, setReturns] = useState<MarketplaceReturn[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState('new');
  const [marketplaceFilter, setMarketplaceFilter] = useState('all');

  const load = () => {
    setLoading(true);
    fetchMarketplaceReturns({ status: statusFilter, marketplace: marketplaceFilter })
      .then((data) => {
        setReturns(data.returns);
        setCounts(data.counts);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, marketplaceFilter]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await syncMarketplaceReturns(30, user?.id, user?.name);
      const errors = [res.ozon.error, res.wildberries.error].filter(Boolean);
      toast({
        title: res.created > 0 ? `Загружено новых возвратов: ${res.created}` : 'Новых возвратов нет',
        description: errors.length > 0 ? errors.join('; ') : undefined,
        variant: errors.length > 0 && res.created === 0 ? 'destructive' : undefined,
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось загрузить возвраты',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleReceive = async (r: MarketplaceReturn) => {
    setProcessingId(r.id);
    try {
      const res = await receiveMarketplaceReturn(r.id, user?.id, user?.name);
      if (res.storageBarcode) {
        // Печатаем стикер хранения сразу: по нему вещь встанет на конкретную полку.
        printBarcodes(
          [{ code: res.storageBarcode, label: r.productName || r.offerId || 'Возврат' }],
          `Стикер хранения ${res.storageBarcode}`
        );
        toast({
          title: 'Возврат принят',
          description: 'Наклейте стикер хранения и отсканируйте вещь на полку',
        });
      } else {
        toast({
          title: 'Возврат принят',
          description: 'Заказ не найден в системе — вещь не заведена на склад автоматически',
        });
      }
      load();
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (r: MarketplaceReturn) => {
    if (!confirm('Отметить, что возврат не приехал?')) return;
    setProcessingId(r.id);
    try {
      await rejectMarketplaceReturn(r.id, user?.id, user?.name);
      toast({ title: 'Возврат отмечен как не приехавший' });
      load();
    } catch (e) {
      toast({
        title: 'Ошибка',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Получение возвратов</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Заявки на возврат подтягиваются с OZON и Wildberries. Отметьте вещь принятой,
              когда коробка доехала до склада
            </p>
          </div>
          <Button onClick={handleSync} disabled={syncing}>
            <Icon
              name={syncing ? 'Loader2' : 'RefreshCw'}
              size={16}
              className={`mr-2 ${syncing ? 'animate-spin' : ''}`}
            />
            Загрузить с маркетплейсов
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Card className="border-border shadow-none">
            <CardContent className="flex items-center gap-2 px-4 py-3">
              <Icon name="PackageOpen" size={18} className="text-amber-600" />
              <span className="text-sm text-muted-foreground">Ждут приёмки</span>
              <span className="text-lg font-bold">{counts.new || 0}</span>
            </CardContent>
          </Card>
          <Card className="border-border shadow-none">
            <CardContent className="flex items-center gap-2 px-4 py-3">
              <Icon name="PackageCheck" size={18} className="text-emerald-600" />
              <span className="text-sm text-muted-foreground">Принято</span>
              <span className="text-lg font-bold">{counts.received || 0}</span>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">Ждут приёмки</SelectItem>
              <SelectItem value="received">Принятые</SelectItem>
              <SelectItem value="rejected">Не приехали</SelectItem>
              <SelectItem value="all">Все</SelectItem>
            </SelectContent>
          </Select>
          <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все маркетплейсы</SelectItem>
              <SelectItem value="OZON">OZON</SelectItem>
              <SelectItem value="WB">Wildberries</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : returns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Возвратов нет. Нажмите «Загрузить с маркетплейсов», чтобы подтянуть свежие заявки.
          </p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">Маркетплейс</TableHead>
                  <TableHead className="text-primary-foreground">Товар</TableHead>
                  <TableHead className="text-primary-foreground">Заказ</TableHead>
                  <TableHead className="text-primary-foreground">Причина</TableHead>
                  <TableHead className="text-primary-foreground">Дата</TableHead>
                  <TableHead className="text-primary-foreground">Статус</TableHead>
                  <TableHead className="text-primary-foreground" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {returns.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className={marketplaceClass[r.marketplace] || 'font-bold'}>
                        {r.marketplace}
                      </span>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">
                        {r.material && r.width
                          ? `${r.material} ${r.width}×${r.height}`
                          : r.productName || '—'}
                      </p>
                      <p className="text-xs text-muted-foreground">{r.offerId}</p>
                    </TableCell>
                    <TableCell>
                      <p className="break-all font-mono-tech text-xs">
                        {r.orderNumber || r.postingNumber || '—'}
                      </p>
                      {!r.orderNumber && (
                        <span className="text-xs text-amber-600">заказ не найден</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[220px] text-sm text-muted-foreground">
                      {r.returnReason || r.mpStatus || '—'}
                    </TableCell>
                    <TableCell className="text-sm">{formatDate(r.mpCreatedAt)}</TableCell>
                    <TableCell>
                      <Badge className={statusLabels[r.status]?.className}>
                        {statusLabels[r.status]?.label || r.status}
                      </Badge>
                      {r.storageBarcode && (
                        <p className="mt-1 font-mono-tech text-xs text-muted-foreground">
                          {r.storageBarcode}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.status === 'new' && (
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            onClick={() => handleReceive(r)}
                            disabled={processingId === r.id}
                          >
                            {processingId === r.id ? (
                              <Icon name="Loader2" size={14} className="animate-spin" />
                            ) : (
                              'Принять'
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleReject(r)}
                            disabled={processingId === r.id}
                          >
                            <Icon name="X" size={14} />
                          </Button>
                        </div>
                      )}
                      {r.status === 'received' && r.receivedByName && (
                        <span className="text-xs text-muted-foreground">{r.receivedByName}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default ReceiveReturns;
