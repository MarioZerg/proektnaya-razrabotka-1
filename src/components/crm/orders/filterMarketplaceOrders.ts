import type { Order } from '@/lib/ordersApi';
import type {
  StatusFilter,
  MarketplaceFilter,
  TypeFilter,
} from '@/components/crm/orders/OrdersToolbar';
import { findDuplicateOrders } from '@/lib/findDuplicateOrders';

// Этап производства заказа определяется по sewingStatus (поле status почти всегда "Новый"
// и реальный прогресс не отражает). Отменённые (status='Отменён') показываются только во
// вкладке "Отменённые" и не попадают в остальные — их видно зачёркнутыми.
const IN_PROGRESS_STAGES = ['На раскрое', 'Раскроено', 'В работе', 'Стикеровка'];
// Заказ закрыт двумя путями: его отшили («Готовые») или вещь взяли готовой со
// склада, минуя цех («Со склада»). Для отдела продаж это одно и то же —
// выполненный заказ. Раньше в «Выполненных» проверялись только «Готовые», и
// больше тысячи заказов «Со склада» не показывались НИ В ОДНОМ фильтре: они
// приходили с сервера, но проваливались мимо всех четырёх условий.
const DONE_STAGES = ['Готовые', 'Со склада'];

interface FilterParams {
  orders: Order[];
  statusFilter: StatusFilter;
  marketplaceFilter: MarketplaceFilter;
  typeFilter: TypeFilter;
  materialFilter: string;
  search: string;
  searchResults: Order[] | null;
}

/** Фильтры, счётчики вкладок и список на экране страницы «Заказы конвейера». */
export const filterMarketplaceOrders = ({
  orders,
  statusFilter,
  marketplaceFilter,
  typeFilter,
  materialFilter,
  search,
  searchResults,
}: FilterParams) => {
  const matchesStatus = (o: Order, filter: StatusFilter = statusFilter): boolean => {
    // Отменяют заказ на любом этапе, и sewingStatus при этом остаётся прежним
    // («Новый», «Готовые», «Со склада»), поэтому проверяем отмену первой.
    //
    // isCancelled считает сервер: отмену видит МАРКЕТПЛЕЙС, и у каждой площадки
    // своё слово для неё (ozon_status='cancelled', ym_status='...CANCELLED'), а наш
    // собственный status при этом не меняется вовсе. Раньше здесь смотрели только
    // на наш status — и вкладка «Отменённые» показывала 149 заказов вместо 1416.
    const cancelled =
      !!o.isCancelled || o.status === 'Отменён' || o.sewingStatus === 'Отменён';
    if (filter === 'cancelled') return cancelled;
    if (cancelled) return false;
    if (filter === 'new') return o.sewingStatus === 'Новый';
    if (filter === 'in_progress') return IN_PROGRESS_STAGES.includes(o.sewingStatus);
    if (filter === 'done') return DONE_STAGES.includes(o.sewingStatus);
    return true;
  };

  // Задвоенные заказы — одна вещь заведена дважды. Показываем предупреждение вверху.
  const duplicates = findDuplicateOrders(orders);

  const baseOrders = orders.filter(
    (o) =>
      matchesStatus(o) &&
      (marketplaceFilter === 'all' || o.marketplace === marketplaceFilter) &&
      (typeFilter === 'all' || o.orderType === typeFilter) &&
      (materialFilter === 'all' || o.material === materialFilter)
  );

  // ПРИ ПОИСКЕ ФИЛЬТРЫ НЕ ПРИМЕНЯЕМ.
  //
  // Человек ищет конкретный заказ по номеру, и он может оказаться отменённым или
  // отгруженным полгода назад. Наложи мы сверху вкладку статуса («Новые»), и
  // найденный заказ тут же исчез бы с экрана — выглядело бы как «поиск не
  // работает», хотя сервер его нашёл.
  const searchActive = search.trim().length >= 2;
  const visibleOrders = searchActive ? searchResults || [] : baseOrders;

  // Материалы для фильтра берём из самих заказов: в списке должно быть только то,
  // что реально стоит в очереди — иначе админ выберет ткань, по которой снимать нечего.
  const materials = Array.from(
    new Set(orders.map((o) => o.material).filter((m): m is string => !!m))
  ).sort((a, b) => a.localeCompare(b, 'ru'));

  const statusCounts: Record<StatusFilter, number> = {
    new: orders.filter((o) => matchesStatus(o, 'new')).length,
    in_progress: orders.filter((o) => matchesStatus(o, 'in_progress')).length,
    done: orders.filter((o) => matchesStatus(o, 'done')).length,
    cancelled: orders.filter((o) => matchesStatus(o, 'cancelled')).length,
  };

  return { duplicates, searchActive, visibleOrders, materials, statusCounts };
};

export default filterMarketplaceOrders;
