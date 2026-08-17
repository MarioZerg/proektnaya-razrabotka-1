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
import ShippedStuckPanel from '@/components/crm/goodsWarehouse/ShippedStuckPanel';
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

  // Списать ненайденную вещь может только старший кладовщик и админ: за этим стоят
  // потраченная ткань и повторная работа цеха. Обычный кладовщик зовёт старшего.
  // Сервер проверяет право ещё раз — спрятанной кнопки для защиты мало.
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
        }
        // Вещи, которые числились на хранении, хотя за ними закреплён живой заказ:
        // в списке их не было, а сканер на них ругался. Возвращаем в работу.
        if (res.restored) {
          toast({
            title: `Возвращено в подбор: ${res.restored}`,
            description: 'Эти вещи были заняты заказами, но не показывались в списке',
          });
        }
        if (res.total > 0 || res.restored) load();
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Фокус в поиске: кладовщик заходит на страницу и сразу пикает сканером, не мышкой.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Ищем по названию товара и номеру заказа: сканер «пикает» номер — строка находится сразу.
  // ОДИН СПИСОК, БЕЗ ВКЛАДОК.
  //
  // Раньше здесь были две вкладки — «Собрать с полок» и «Донести в короб»: вещь
  // с напечатанным стикером уезжала из первого списка во второй. Кладовщики от этого
  // путались: вещь пропадала из списка, по которому они шли вдоль стеллажа, и
  // приходилось искать её на другой вкладке.
  //
  // На деле разделение не нужно — они и так понимают: стикер наклеен, значит вещь
  // надо отсканировать в поставку. Поэтому вещь остаётся в общем списке до тех пор,
  // пока её не отправят на поставку кнопкой в карточке. Печать стикера сама по себе
  // из списка ничего не убирает.
  const labeledCount = useMemo(
    () => orders.filter((o) => o.status === 'awaiting_supply').length,
    [orders]
  );

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

  /** Главные числа дня: сколько собирать по FBS и сколько по FBO.
   * Работа разная — FBS клеится поштучно, FBO уезжает коробкой. */
  const fbsCount = useMemo(
    () => filtered.filter((o) => (o.orderType || '').toUpperCase() === 'FBS').length,
    [filtered]
  );
  const fboCount = useMemo(
    () => filtered.filter((o) => (o.orderType || '').toUpperCase() === 'FBO').length,
    [filtered]
  );

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

        {/* Два главных числа дня. FBS собирают поштучно — на каждую вещь свой ярлык
            маркетплейса; FBO складывают коробкой на склад площадки. Это разная работа
            и разный маршрут по складу, поэтому общая сумма кладовщику ничего не даёт:
            он планирует день по этим двум цифрам. Нажатие фильтрует список. */}
        {orders.length > 0 && (
          <div className="grid max-w-xl grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSearch(search.toLowerCase() === 'fbs' ? '' : 'FBS')}
              className={`rounded-lg border-2 p-3 text-left transition ${
                search.toLowerCase() === 'fbs'
                  ? 'border-sky-500 bg-sky-100'
                  : 'border-sky-200 bg-sky-50 hover:bg-sky-100'
              }`}
            >
              <p className="text-3xl font-bold text-sky-800">{fbsCount}</p>
              <p className="text-sm font-medium text-sky-900">FBS — поштучно с ярлыком</p>
            </button>
            <button
              type="button"
              onClick={() => setSearch(search.toLowerCase() === 'fbo' ? '' : 'FBO')}
              className={`rounded-lg border-2 p-3 text-left transition ${
                search.toLowerCase() === 'fbo'
                  ? 'border-violet-500 bg-violet-100'
                  : 'border-violet-200 bg-violet-50 hover:bg-violet-100'
              }`}
            >
              <p className="text-3xl font-bold text-violet-800">{fboCount}</p>
              <p className="text-sm font-medium text-violet-900">FBO — коробкой на склад</p>
            </button>
          </div>
        )}

        <PickingScanDialog
          open={scanOpen}
          onOpenChange={setScanOpen}
          onOpenCard={(goodsId) => navigate(`/crm/inventory/goods/${goodsId}`)}
        />

        {/* Позиции, которые уже уехали к клиентам: их закрывает администратор,
            иначе они висят в подборе вечно. */}
        <ShippedStuckPanel onReload={load} />

        {/* Сколько вещей уже со стикером. Это не отдельный список, а подсказка:
            такие строки помечены в таблице, и по ним осталось одно действие —
            отправить на поставку из карточки. */}
        {labeledCount > 0 && (
          <div className="flex gap-2 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
            <Icon name="Info" size={18} className="mt-0.5 shrink-0" />
            <div>
              Со стикером: {labeledCount}. Такие вещи помечены в списке — найдите их на
              полке и отправьте на поставку кнопкой в карточке. До этого они никуда
              не едут и из списка не пропадают.
            </div>
          </div>
        )}

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
                        {/* Стикер напечатан — вещь ОСТАЁТСЯ в общем списке и просто
                            помечается. Раньше она уезжала на отдельную вкладку или
                            вовсе исчезала: кладовщик шёл вдоль стеллажа по списку,
                            строка пропадала, а на полке сотни одинаковых пакетов —
                            найти вещь без номера полки на экране почти невозможно.
                            Из списка вещь уходит только после отправки на поставку. */}
                        {o.shippingLabeledAt && (
                          <div className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                            <Icon name="Printer" size={12} />
                            {o.status === 'awaiting_supply'
                              ? 'Стикер наклеен — отсканируйте в короб'
                              : 'Стикер наклеен — отправьте на поставку'}
                          </div>
                        )}
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
                      {/* Кнопки «Не нашёл» здесь больше нет: она дублировала действие
                          из карточки товара. Решение «вещи нет» платное — заказ едет
                          шиться заново, ткань и работа цеха тратятся второй раз, — и
                          принимать его мимоходом из строки списка не стоит. Теперь оно
                          в карточке, в меню «Действия с товаром», рядом с отправкой
                          в пошив: кладовщик открывает вещь и выбирает, что с ней. */}
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