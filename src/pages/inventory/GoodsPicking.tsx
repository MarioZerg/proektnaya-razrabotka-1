import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { usePolling } from '@/hooks/usePolling';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import PickingScanDialog from '@/components/crm/goodsWarehouse/PickingScanDialog';
import {
  fetchPickingOrders,
  verifyPicking,
  type PickingOrder,
} from '@/lib/goodsWarehouseApi';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { shortProductName } from '@/lib/shortProductName';

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
  const { toast } = useToast();
  const { user } = useAuth();

  const [orders, setOrders] = useState<PickingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    fetchPickingOrders()
      .then(setOrders)
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  };

  // Заказы приходят в течение дня — обновляем сами, чтобы кладовщик не жал F5.
  // Раз в минуту и только пока на экран смотрят: свёрнутая вкладка не тратит ничего.
  usePolling(load, 60000);

  // Перед работой сверяем список с маркетплейсом: часть заказов, пока вещи лежали на
  // полке, уже уехала к покупателю или отменилась. Ярлык для них не выдадут, собрать
  // такие вещи невозможно — они возвращаются на полку, а не отправляют кладовщика
  // к стеллажу за мёртвой работой.
  useEffect(() => {
    verifyPicking(undefined, user?.id, user?.name)
      .then((res) => {
        if (res.total > 0) {
          toast({
            title: `Снято с подбора: ${res.total}`,
            description: 'Заказы отменены или уже уехали — вещи вернулись на полку хранения',
          });
          load();
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        o.material?.toLowerCase().includes(q) ||
        // По «ozon», «wb», «fbs», «fbo» — кладовщик отбирает работу одного вида,
        // чтобы собрать её за один проход по складу.
        o.marketplace?.toLowerCase().includes(q) ||
        o.orderType?.toLowerCase().includes(q)
    );
  }, [orders, search]);

  /** Разбивка отобранного по площадке и схеме: «OZON FBS: 9», «OZON FBO: 19». */
  const byScheme = useMemo(() => {
    const acc: Record<string, number> = {};
    filtered.forEach((o) => {
      const label = `${(o.marketplace || '—').toUpperCase()} ${o.orderType || ''}`.trim();
      acc[label] = (acc[label] || 0) + 1;
    });
    return acc;
  }, [filtered]);

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

        <PickingScanDialog
          open={scanOpen}
          onOpenChange={setScanOpen}
          onOpenCard={(goodsId) => navigate(`/crm/inventory/goods/${goodsId}`)}
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
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">
                {search
                  ? `Найдено: ${filtered.length} из ${orders.length}`
                  : `Заказов к подбору: ${orders.length}`}
              </p>
              {/* Сколько работы какого вида: FBS собирают поштучно с ярлыками,
                  FBO складывают коробкой. Кладовщик планирует день по этим числам. */}
              {Object.entries(byScheme).map(([label, count]) => (
                <Badge key={label} variant="outline" className="font-normal">
                  {label}: {count}
                </Badge>
              ))}
            </div>
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground">Товар</TableHead>
                    <TableHead className="text-primary-foreground">Куда поедет</TableHead>
                    <TableHead className="text-primary-foreground">Полка</TableHead>
                    <TableHead className="text-primary-foreground">Дата создания</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => (
                    <TableRow
                      key={o.id}
                      onClick={() => navigate(`/crm/inventory/goods/${o.id}`)}
                      className="cursor-pointer hover:bg-muted/60"
                    >
                      <TableCell>
                        <div className="font-medium" title={o.product || ''}>
                          {shortProductName(o)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {o.orderNumber || '—'}
                          {o.storageBarcode ? ` · ${o.storageBarcode}` : ''}
                        </div>
                      </TableCell>
                      {/* Куда поедет вещь: площадка и схема. Работа у них разная —
                          на FBS клеится ярлык маркетплейса и вещь едет своим пакетом,
                          FBO уходит коробкой на склад площадки. Кладовщик должен видеть
                          это в списке, а не открывать карточку каждой вещи. */}
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="secondary" className="font-normal">
                            {(o.marketplace || '—').toUpperCase()}
                          </Badge>
                          {o.orderType && (
                            <Badge
                              className={
                                o.orderType === 'FBS'
                                  ? 'bg-sky-100 font-semibold text-sky-800 hover:bg-sky-100'
                                  : 'bg-violet-100 font-semibold text-violet-800 hover:bg-violet-100'
                              }
                            >
                              {o.orderType}
                            </Badge>
                          )}
                        </div>
                        {o.cluster && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {o.cluster}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div>{o.shelfName || '—'}</div>
                        {/* Запасной вариант: такие же вещи, свободно лежащие на складе.
                            Если по своей полке вещи не оказалось (переложили, забрали и
                            не отметили, ошиблись при инвентаризации), кладовщик сразу
                            видит, есть ли замена и с какой полки её взять — вместо того
                            чтобы отправлять заказ в цех шиться заново. */}
                        {!!o.alsoOnShelves?.length && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            Ещё{' '}
                            {o.alsoOnShelves.reduce((sum, x) => sum + x.count, 0)} шт:{' '}
                            {o.alsoOnShelves
                              .map((x) => `${x.shelfName} (${x.count})`)
                              .join(', ')}
                          </div>
                        )}
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