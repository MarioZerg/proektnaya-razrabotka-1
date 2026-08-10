import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { fetchPickingOrders, type PickingOrder } from '@/lib/goodsWarehouseApi';

/** Дата в привычном виде: «10.08.2026, 16:15». */
const formatDate = (value: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Товар к подбору — заказы, под которые нужно найти готовую вещь на складе.
 *
 * Сюда падают новые заказы: их ещё не начали шить и готовая вещь под них не найдена.
 * Кладовщик смотрит список и решает, что можно закрыть складскими остатками.
 */
const GoodsPicking = () => {
  const navigate = useNavigate();

  const [orders, setOrders] = useState<PickingOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetchPickingOrders()
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // Заказы приходят в течение дня — обновляем сами, чтобы кладовщик не жал F5.
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/crm/inventory/goods-warehouse')}
            className="-ml-2 mb-2"
          >
            <Icon name="ChevronLeft" size={16} className="mr-1" />
            К складу товара
          </Button>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold">Товар к подбору</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Заказы, под которые нужно найти готовую вещь на складе
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <Icon
                name={loading ? 'Loader2' : 'RefreshCw'}
                size={14}
                className={`mr-1.5 ${loading ? 'animate-spin' : ''}`}
              />
              Обновить
            </Button>
          </div>
        </div>

        {loading && orders.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">Заказов к подбору нет</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Заказов к подбору: {orders.length}</p>
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground">Товар</TableHead>
                    <TableHead className="text-primary-foreground">Дата создания</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <div className="font-medium">{o.product || '—'}</div>
                        <div className="text-xs text-muted-foreground">
                          {o.orderNumber || '—'}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(o.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default GoodsPicking;
