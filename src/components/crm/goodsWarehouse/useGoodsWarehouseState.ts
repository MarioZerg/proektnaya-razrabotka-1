import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import {
  fetchGoodsWarehouse,
  returnGoodsToWorkshop,
  markGoodsLost,
  deleteGoods,
  type GoodsWarehouseItem,
} from '@/lib/goodsWarehouseApi';
import { fetchShelves, type Shelf } from '@/lib/shelvesApi';
import { fetchMarketplaceReturns } from '@/lib/marketplaceReturnsApi';
import { fetchInspection } from '@/lib/goodsWarehouseApi';
import { usePickingPending } from '@/hooks/usePickingPending';
import { useTablePage } from '@/components/crm/finance/useTablePage';

/**
 * Вся «начинка» склада товара: загрузка, фильтры, счётчики и действия над вещами.
 *
 * Вынесено из страницы, чтобы разметку можно было читать сверху вниз, не продираясь
 * через полторы сотни строк расчётов. Логика перенесена один в один — здесь нет
 * ни одного нового условия.
 */
export const useGoodsWarehouseState = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  /** Ручную приёмку делает и кладовщик: излишек с производства приносят прямо ему на склад,
   * ждать администратора, чтобы завести вещь и напечатать стикер, — терять время. */
  const canReceiveManually = isAdmin || isStorekeeperRole(user?.role);

  const [items, setItems] = useState<GoodsWarehouseItem[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('in_stock');
  const [materialFilter, setMaterialFilter] = useState('');
  const [widthFilter, setWidthFilter] = useState('');
  const [heightFilter, setHeightFilter] = useState('');
  const [shelfFilter, setShelfFilter] = useState('');

  // Разложить отменённые товары по полкам (сканером) и стикеровка заказов с полок
  const [placeOpen, setPlaceOpen] = useState(false);
  const [pickupOpen, setPickupOpen] = useState(false);
  // Осмотренные в цехе вещи, которые ждут, когда кладовщик заберёт их на полку.
  const [inspectedReady, setInspectedReady] = useState(0);
  const [placeInspectedOpen, setPlaceInspectedOpen] = useState(false);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [adminReceiveOpen, setAdminReceiveOpen] = useState(false);

  // Смена полки
  const [moveOpen, setMoveOpen] = useState(false);

  const load = () => {
    setLoading(true);
    // Товар попадает на склад только по сканированию стикера хранения — вручную выбрать
    // заказ и «положить» его на полку нельзя, поэтому список заказов здесь больше не нужен.
    // Полки грузим отдельно от товара: если связь моргнула и справочник не дошёл,
    // склад всё равно покажется. Раньше один сбой оставлял страницу пустой.
    fetchShelves().then(setShelves).catch(() => {});
    // Кружок загрузки снимаем по главному запросу страницы.
    fetchGoodsWarehouse()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // Возвраты, забранные с пункта выдачи, но ещё не осмотренные: товар привезли,
  // а решение (полка / перепаковка / утиль) кладовщик ещё не принял. Пока вещь не
  // лежит на полке, она считается непроверенной и в подбор не попадает.
  const [uncheckedReturns, setUncheckedReturns] = useState(0);

  // Подбор теперь открывается только отсюда — держим на кнопке живой счётчик,
  // чтобы кладовщик видел работу, не заходя внутрь.
  //
  // Тот же счётчик крутится и в меню, поэтому на этой странице хук работает дважды.
  // Голос при этом звучит ОДИН раз: повтор того же сигнала гасится минутной паузой
  // внутри playWarehouseAlert, а сами запросы к серверу не дублируются — ответ
  // общий на 15 секунд.
  const { pending: pickingPending } = usePickingPending(true);

  // Сколько вещей упаковщица уже осмотрела и подготовила к выдаче на склад.
  // Это третий шаг работы с возвратами, поэтому счётчик нужен прямо на плитке.
  const loadInspectedReady = () => {
    fetchInspection('inspected')
      // counts.inspected уже включает забранные из цеха — складывать не нужно.
      .then((d) => setInspectedReady(d.counts.inspected || 0))
      .catch(() => setInspectedReady(0));
  };

  useEffect(() => {
    loadInspectedReady();
  }, []);

  useEffect(() => {
    fetchMarketplaceReturns({ status: 'picked_up' })
      .then((d) => setUncheckedReturns(d.counts.picked_up || 0))
      .catch(() => setUncheckedReturns(0));
  }, []);

  // Вещи, отменённые клиентом: упаковщик наклеил стикер хранения, кладовщик ещё не положил
  // их на полку — именно их он забирает из цеха.
  //
  // Возвраты с маркетплейса (mp_return) сюда НЕ входят. Это разные потоки: у вещи
  // из цеха судьба уже ясна — она годная, ей нужна полка. А по возврату от покупателя
  // кладовщик сначала принимает решение: годная — на полку, мятая или под вопросом —
  // в цех на осмотр. Смешивать их в одной кнопке нельзя: решение подменялось бы
  // автоматической укладкой, и вещи с дефектом уезжали бы на полку как годные.
  const pendingShelf = useMemo(
    () => items.filter((i) => i.status === 'awaiting_shelf'),
    [items],
  );

  // Возвраты с маркетплейса, привезённые с ПВЗ и ждущие решения кладовщика.
  const pendingReturns = useMemo(
    () => items.filter((i) => i.status === 'mp_return'),
    [items],
  );

  const materialsList = useMemo(
    () => Array.from(new Set(items.map((i) => i.material).filter((m): m is string => !!m))).sort(),
    [items]
  );

  // Списки ширин и высот собираем из того, что реально лежит на складе.
  const widthsList = useMemo(
    () => Array.from(new Set(items.map((i) => i.width).filter((w): w is number => !!w))).sort((a, b) => a - b),
    [items]
  );
  const heightsList = useMemo(
    () => Array.from(new Set(items.map((i) => i.height).filter((h): h is number => !!h))).sort((a, b) => a - b),
    [items]
  );

  const q = search.trim().toLowerCase();

  const filtered = items.filter((i) => {
    // Поиск идёт по всему, чем вещь можно назвать: стикер хранения (его пикают сканером),
    // номер заказа — свой и тот, под который вещь подобрана, название и материал.
    // Пока в строке что-то есть, статус не ограничиваем: кладовщик ищет конкретную вещь
    // и не должен гадать, в каком она сейчас состоянии.
    if (q) {
      const haystack = [
        i.storageBarcode,
        i.orderNumber,
        i.reservedOrderNumber,
        i.product,
        i.material,
        i.shelfName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    } else if (statusFilter !== 'all' && i.status !== statusFilter) return false;
    if (materialFilter && i.material !== materialFilter) return false;
    if (widthFilter && i.width !== Number(widthFilter)) return false;
    if (heightFilter && i.height !== Number(heightFilter)) return false;
    // 'none' — вещи без полки: приняты, но ещё не разложены.
    if (shelfFilter === 'none' ? i.shelfId != null : shelfFilter && String(i.shelfId) !== shelfFilter)
      return false;
    return true;
  });

  // Склад копится каждый день: без фильтра в списке больше тысячи вещей всех статусов.
  // Такая портянка грузит планшет и в ней невозможно ничего найти глазами — режем на
  // страницы по 50 строк. Данные уже загружены, лишних запросов к серверу не будет.
  const {
    visible: pagedItems,
    page,
    setPage,
    totalPages,
    total,
  } = useTablePage(filtered, 50);

  // Сменили фильтр или поиск — возвращаемся на первую страницу: иначе человек остаётся
  // на пятой странице нового, короткого списка и видит пустоту.
  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, statusFilter, materialFilter, widthFilter, heightFilter, shelfFilter]);

  // Считаем остатки по полкам только среди товаров, которые реально лежат на складе:
  // отгруженные и утерянные вещи собирать не нужно.
  const shelfCounts = useMemo(() => {
    const acc: Record<number, number> = {};
    items.forEach((i) => {
      if (i.status !== 'in_stock' && i.status !== 'picking') return;
      if (i.shelfId == null) return;
      acc[i.shelfId] = (acc[i.shelfId] || 0) + 1;
    });
    return acc;
  }, [items]);

  const noShelfCount = useMemo(
    () =>
      items.filter(
        (i) =>
          i.shelfId == null &&
          (i.status === 'in_stock' || i.status === 'awaiting_shelf' || i.status === 'mp_return'),
      ).length,
    [items],
  );

  const activeFiltersCount = [
    !!q,
    statusFilter !== 'in_stock',
    !!materialFilter,
    !!widthFilter,
    !!heightFilter,
    !!shelfFilter,
  ].filter(Boolean).length;

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setMaterialFilter('');
    setWidthFilter('');
    setHeightFilter('');
    setShelfFilter('');
  };

  const openMove = () => {
    setMoveOpen(true);
  };

  const handleReturn = async (id: number) => {
    try {
      await returnGoodsToWorkshop(id);
      toast({ title: 'Товар возвращён в цех' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const handleMarkLost = async (id: number, reason: string) => {
    try {
      await markGoodsLost(id, reason);
      toast({ title: 'Товар отмечен утерянным' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  // Удаление со склада: доступно только администратору и только для вещей на хранении.
  // Сервер проверяет это повторно — права нельзя обойти через интерфейс.
  const handleDeleteGoods = async (id: number) => {
    try {
      await deleteGoods(id, user?.id, user?.name);
      toast({ title: 'Товар удалён со склада' });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось удалить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return {
    isAdmin,
    canReceiveManually,
    shelves,
    loading,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    materialFilter,
    setMaterialFilter,
    widthFilter,
    setWidthFilter,
    heightFilter,
    setHeightFilter,
    shelfFilter,
    setShelfFilter,
    placeOpen,
    setPlaceOpen,
    pickupOpen,
    setPickupOpen,
    inspectedReady,
    placeInspectedOpen,
    setPlaceInspectedOpen,
    reprintOpen,
    setReprintOpen,
    adminReceiveOpen,
    setAdminReceiveOpen,
    moveOpen,
    setMoveOpen,
    load,
    loadInspectedReady,
    uncheckedReturns,
    pickingPending,
    pendingShelf,
    pendingReturns,
    materialsList,
    widthsList,
    heightsList,
    filtered,
    pagedItems,
    page,
    setPage,
    totalPages,
    total,
    shelfCounts,
    noShelfCount,
    activeFiltersCount,
    resetFilters,
    openMove,
    handleReturn,
    handleMarkLost,
    handleDeleteGoods,
  };
};

export default useGoodsWarehouseState;