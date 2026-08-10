import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import ShipLabelDialog from '@/components/crm/goodsWarehouse/ShipLabelDialog';
import {
  fetchGoodsWarehouse,
  fetchPickingOrders,
  type GoodsWarehouseItem,
  type PickingOrder,
} from '@/lib/goodsWarehouseApi';

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
  const [search, setSearch] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  /** Вещи с полок, подобранные под заказы: их сканируют и стикеруют. */
  const [matched, setMatched] = useState<GoodsWarehouseItem[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    Promise.all([fetchPickingOrders(), fetchGoodsWarehouse('in_stock')])
      .then(([ordersData, stock]) => {
        setOrders(ordersData);
        setMatched(stock.filter((i) => i.reservedOrderId && !i.shippingLabeledAt));
      })
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // Заказы приходят в течение дня — обновляем сами, чтобы кладовщик не жал F5.
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  // Фокус в поиске: кладовщик заходит на страницу и сразу пикает сканером, не мышкой.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Ищем по названию товара и номеру заказа: сканер «пикает» номер — строка находится сразу.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter(
      (o) =>
        o.product?.toLowerCase().includes(q) ||
        o.orderNumber?.toLowerCase().includes(q) ||
        o.storageBarcode?.toLowerCase().includes(q) ||
        o.shelfName?.toLowerCase().includes(q) ||
        o.material?.toLowerCase().includes(q)
    );
  }, [orders, search]);

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
                Вещи, подобранные под заказы: заберите с полки и наклейте стикер
              </p>
            </div>
            <div className="flex gap-2">
              {/* Сканер подбора: отсканировал вещь с полки — сразу печать стикера. */}
              <Button onClick={() => setScanOpen(true)}>
                <Icon name="ScanLine" size={16} className="mr-2" />
                Сканер подбора
                {matched.length > 0 && (
                  <span className="ml-2 rounded-full bg-background/25 px-2 text-xs">
                    {matched.length}
                  </span>
                )}
              </Button>
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
        </div>

        {/* Поиск по списку: поле в фокусе, можно пикнуть сканером и сразу найти товар. */}
        <div className="relative max-w-xl">
          <Icon
            name="Search"
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchRef}
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск: товар, заказ, стикер или полка"
            className="pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                searchRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <Icon name="X" size={16} />
            </button>
          )}
        </div>

        <ShipLabelDialog
          open={scanOpen}
          onOpenChange={setScanOpen}
          matched={matched}
          onDone={load}
        />

        {loading && orders.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {search ? 'По запросу ничего не найдено' : 'Заказов к подбору нет'}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {search
                ? `Найдено: ${filtered.length} из ${orders.length}`
                : `Заказов к подбору: ${orders.length}`}
            </p>
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground">Товар</TableHead>
                    <TableHead className="text-primary-foreground">Полка</TableHead>
                    <TableHead className="text-primary-foreground">Дата создания</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <div className="font-medium">{o.product || '—'}</div>
                        <div className="text-xs text-muted-foreground">
                          {o.orderNumber || '—'}
                          {o.storageBarcode ? ` · ${o.storageBarcode}` : ''}
                        </div>
                      </TableCell>
                      <TableCell>{o.shelfName || '—'}</TableCell>
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