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
import ReturnScanCard from '@/components/crm/returns/ReturnScanCard';
import {
  fetchMarketplaceReturns,
  syncMarketplaceReturns,
  approveMarketplaceReturn,
  rejectMarketplaceReturn,
  type MarketplaceReturn,
} from '@/lib/marketplaceReturnsApi';

const statusLabels: Record<string, { label: string; className: string }> = {
  new: { label: 'Ждёт решения', className: 'bg-amber-500 text-white hover:bg-amber-500' },
  approved: { label: 'Одобрен, едет к нам', className: 'bg-blue-600 text-white hover:bg-blue-600' },
  picked_up: {
    label: 'Забран, ждёт разбора',
    className: 'bg-violet-600 text-white hover:bg-violet-600',
  },
  processed: { label: 'Обработан', className: 'bg-emerald-600 text-white hover:bg-emerald-600' },
  rejected: { label: 'Отклонён', className: '' },
};

/** Что кладовщик сделал с приехавшей вещью. */
const outcomeLabels: Record<string, { label: string; className: string }> = {
  utilized: { label: 'Утилизирован', className: 'text-destructive' },
  repack: { label: 'На перепаковке', className: 'text-amber-600' },
  stored: { label: 'На складе', className: 'text-emerald-600' },
};

/** В базе площадки записаны кодом — в списке показываем привычные названия. */
const marketplaceNames: Record<string, string> = {
  WB: 'Wildberries',
  Yandex: 'Яндекс Маркет',
};

const marketplaceClass: Record<string, string> = {
  OZON: 'text-[#005BFF] font-bold',
  WB: 'text-[#CB11AB] font-bold',
  Yandex: 'text-[#FC3F1D] font-bold',
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
  const [outcomes, setOutcomes] = useState<Record<string, number>>({});
  // Админ решает по заявкам (одобрить/отклонить) и видит отчёт по утилизации.
  // Кладовщик работает только с приехавшими вещами — сканирует стикеры возврата.
  const isAdmin = user?.role === 'admin';
  const [statusFilter, setStatusFilter] = useState(isAdmin ? 'new' : 'approved');
  const [marketplaceFilter, setMarketplaceFilter] = useState('all');

  const load = () => {
    setLoading(true);
    fetchMarketplaceReturns({ status: statusFilter, marketplace: marketplaceFilter })
      .then((data) => {
        setReturns(data.returns);
        setCounts(data.counts);
        setOutcomes(data.outcomes);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, marketplaceFilter]);

  // Новые возвраты приходят сами: подтягиваем их при открытии страницы и раз в 5 минут,
  // пока она открыта. Кнопка остаётся для случая «жду прямо сейчас, обнови немедленно».
  // Сервер сам пропустит запрос, если данные свежие, — лимиты маркетплейсов бережём.
  useEffect(() => {
    let alive = true;
    const autoSync = async () => {
      try {
        const res = await syncMarketplaceReturns(30, user?.id, user?.name, true);
        if (alive && res.created > 0) {
          toast({ title: `Пришли новые возвраты: ${res.created}` });
          load();
        }
      } catch {
        // Молча: фоновая загрузка не должна мешать работать со списком.
      }
    };
    autoSync();
    const timer = setInterval(autoSync, 300000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await syncMarketplaceReturns(30, user?.id, user?.name);
      // Ошибку любой площадки нужно показать: иначе «новых нет» будет означать
      // и «действительно нет», и «интеграция отвалилась».
      const errors = [
        res.ozon.error,
        res.wildberries.error,
        res.yandexMarket?.error,
      ].filter(Boolean);
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

  const handleApprove = async (r: MarketplaceReturn) => {
    setProcessingId(r.id);
    try {
      await approveMarketplaceReturn(r.id, user?.id, user?.name);
      toast({
        title: 'Заявка одобрена',
        description: 'Вещь поедет к нам — кладовщик примет её по стикеру возврата',
      });
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
    if (!confirm('Отклонить заявку на возврат?')) return;
    setProcessingId(r.id);
    try {
      await rejectMarketplaceReturn(r.id, user?.id, user?.name);
      toast({ title: 'Заявка отклонена' });
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
            <h1 className="text-xl font-bold">Приём возвратов</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isAdmin
                ? 'Заявки с OZON и Wildberries. Одобренные вещи поедут к нам — кладовщик примет их по стикеру возврата'
                : 'Отсканируйте стикер возврата на коробке и решите судьбу вещи'}
            </p>
          </div>
          {isAdmin && (
          <Button onClick={handleSync} disabled={syncing}>
            <Icon
              name={syncing ? 'Loader2' : 'RefreshCw'}
              size={16}
              className={`mr-2 ${syncing ? 'animate-spin' : ''}`}
            />
            Загрузить с маркетплейсов
          </Button>
          )}
        </div>

        {/* Кладовщик принимает приехавшие вещи сканированием — заявки он не одобряет. */}
        {!isAdmin && <ReturnScanCard onProcessed={load} />}

        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Card className="border-border shadow-none">
              <CardContent className="flex items-center gap-2 px-4 py-3">
                <Icon name="Clock" size={18} className="text-amber-600" />
                <span className="text-sm text-muted-foreground">Ждут решения</span>
                <span className="text-lg font-bold">{counts.new || 0}</span>
              </CardContent>
            </Card>
          )}
          <Card className="border-border shadow-none">
            <CardContent className="flex items-center gap-2 px-4 py-3">
              <Icon name="Truck" size={18} className="text-blue-600" />
              <span className="text-sm text-muted-foreground">Едут к нам</span>
              <span className="text-lg font-bold">{counts.approved || 0}</span>
            </CardContent>
          </Card>
          {/* Забрали с пункта выдачи, но ещё не осмотрели: эти вещи лежат
              на складе неразобранными и ждут решения кладовщика. */}
          <Card className="border-border shadow-none">
            <CardContent className="flex items-center gap-2 px-4 py-3">
              <Icon name="PackageOpen" size={18} className="text-violet-600" />
              <span className="text-sm text-muted-foreground">Ждут разбора</span>
              <span className="text-lg font-bold">{counts.picked_up || 0}</span>
            </CardContent>
          </Card>
          <Card className="border-border shadow-none">
            <CardContent className="flex items-center gap-2 px-4 py-3">
              <Icon name="PackageCheck" size={18} className="text-emerald-600" />
              <span className="text-sm text-muted-foreground">На складе</span>
              <span className="text-lg font-bold">{outcomes.stored || 0}</span>
            </CardContent>
          </Card>
          <Card className="border-border shadow-none">
            <CardContent className="flex items-center gap-2 px-4 py-3">
              <Icon name="PackageOpen" size={18} className="text-amber-600" />
              <span className="text-sm text-muted-foreground">На перепаковке</span>
              <span className="text-lg font-bold">{outcomes.repack || 0}</span>
            </CardContent>
          </Card>
          {isAdmin && (
            <Card className="border-border shadow-none">
              <CardContent className="flex items-center gap-2 px-4 py-3">
                <Icon name="Trash2" size={18} className="text-destructive" />
                <span className="text-sm text-muted-foreground">Утилизировано</span>
                <span className="text-lg font-bold">{outcomes.utilized || 0}</span>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {isAdmin && <SelectItem value="new">Ждут решения</SelectItem>}
              <SelectItem value="approved">Едут к нам</SelectItem>
              <SelectItem value="picked_up">Забраны, ждут разбора</SelectItem>
              <SelectItem value="processed">Обработанные</SelectItem>
              {isAdmin && <SelectItem value="rejected">Отклонённые</SelectItem>}
              <SelectItem value="all">Все</SelectItem>
            </SelectContent>
          </Select>
          <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
            <SelectTrigger className="w-full sm:w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все маркетплейсы</SelectItem>
              <SelectItem value="OZON">OZON</SelectItem>
              <SelectItem value="WB">Wildberries</SelectItem>
              <SelectItem value="Yandex">Яндекс Маркет</SelectItem>
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
                        {marketplaceNames[r.marketplace] || r.marketplace}
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
                      {r.outcome && (
                        <p className={`mt-1 text-xs font-medium ${outcomeLabels[r.outcome]?.className}`}>
                          {outcomeLabels[r.outcome]?.label}
                        </p>
                      )}
                      {r.damageNote && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{r.damageNote}</p>
                      )}
                      {r.storageBarcode && r.outcome !== 'utilized' && (
                        <p className="mt-1 font-mono-tech text-xs text-muted-foreground">
                          {r.storageBarcode}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* Решение по заявке принимает только админ. Кладовщик приехавшие вещи
                          обрабатывает сканированием стикера возврата в блоке выше. */}
                      {isAdmin && r.status === 'new' && (
                        <div className="flex gap-1.5">
                          <Button
                            size="sm"
                            onClick={() => handleApprove(r)}
                            disabled={processingId === r.id}
                          >
                            {processingId === r.id ? (
                              <Icon name="Loader2" size={14} className="animate-spin" />
                            ) : (
                              'Одобрить'
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
                      {r.status === 'processed' && r.outcomeByName && (
                        <span className="text-xs text-muted-foreground">{r.outcomeByName}</span>
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