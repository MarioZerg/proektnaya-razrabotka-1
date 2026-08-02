export type Role = 'sewer' | 'cutter' | 'packer' | 'storekeeper' | 'cleaner' | 'admin';

/**
 * Зона доступа — укрупнённая группировка ролей, используется для разграничения прав
 * там, где неважна конкретная должность, а важна принадлежность к общей зоне
 * (например, кто может подтвердить приём поставки в цех). Ничего не хранится в БД —
 * зона всегда вычисляется на лету по текущей роли пользователя.
 *   - admin     — Администраторы: полный доступ везде
 *   - warehouse — Работники складов: кладовщик
 *   - workshop  — Работники цехов: швея, закройщик, упаковщик
 *   - none      — вне зон (уборщица) — доступа к отгрузкам нет
 */
export type AccessZone = 'admin' | 'warehouse' | 'workshop' | 'none';

export const getAccessZone = (role: Role | undefined | null): AccessZone => {
  if (role === 'admin') return 'admin';
  if (role === 'storekeeper') return 'warehouse';
  if (role === 'sewer' || role === 'cutter' || role === 'packer') return 'workshop';
  return 'none';
};

export interface NavChild {
  label: string;
  path: string;
}

export interface NavItem {
  label: string;
  icon: string;
  path?: string;
  children?: NavChild[];
}

export const roleLabels: Record<Role, string> = {
  sewer: 'Швея',
  cutter: 'Закройщик',
  packer: 'Упаковщик',
  storekeeper: 'Кладовщик',
  cleaner: 'Уборщица',
  admin: 'Администратор',
};

const productionNav: NavItem[] = [
  { label: 'Главная', icon: 'LayoutDashboard', path: '/crm' },
  {
    label: 'Инвентаризация',
    icon: 'Boxes',
    children: [{ label: 'Материалы в цехе', path: '/crm/inventory/workshop-materials' }],
  },
  {
    label: 'Отгрузки',
    icon: 'Truck',
    children: [
      { label: 'Отгрузка в цех', path: '/crm/shipments/to-workshop' },
      { label: 'Передать брак на склад', path: '/crm/shipments/defect-to-warehouse' },
    ],
  },
  {
    label: 'Маркетплейсы',
    icon: 'ShoppingBag',
    children: [{ label: 'Товары для пошива', path: '/crm/marketplace/sewing-items' }],
  },
  { label: 'Финансы', icon: 'Wallet', path: '/crm/finance' },
];

const packerNav: NavItem[] = [
  { label: 'Главная', icon: 'LayoutDashboard', path: '/crm' },
  {
    label: 'Инвентаризация',
    icon: 'Boxes',
    children: [{ label: 'Материалы в цехе', path: '/crm/inventory/workshop-materials' }],
  },
  {
    label: 'Отгрузки',
    icon: 'Truck',
    children: [
      { label: 'Отгрузка в цех', path: '/crm/shipments/to-workshop' },
      { label: 'Передать брак на склад', path: '/crm/shipments/defect-to-warehouse' },
    ],
  },
  {
    label: 'Маркетплейсы',
    icon: 'ShoppingBag',
    children: [{ label: 'Товары для пошива', path: '/crm/marketplace/sewing-items' }],
  },
  { label: 'Терминал стикеровки', icon: 'ScanLine', path: '/crm/kiosk' },
  { label: 'Финансы', icon: 'Wallet', path: '/crm/finance' },
];

const storekeeperNav: NavItem[] = [
  { label: 'Главная', icon: 'LayoutDashboard', path: '/crm' },
  {
    label: 'Инвентаризация',
    icon: 'Boxes',
    children: [
      { label: 'Материалы на складе', path: '/crm/inventory/warehouse-materials' },
      { label: 'Материалы в цехе', path: '/crm/inventory/workshop-materials' },
      { label: 'Склад товара', path: '/crm/inventory/goods-warehouse' },
      { label: 'Товар к подбору', path: '/crm/inventory/goods-picking' },
      { label: 'Возвраты на осмотр', path: '/crm/inventory/returns-inspection' },
      { label: 'Инвентаризации', path: '/crm/inventory/stocktakes' },
      { label: 'Рулоны', path: '/crm/inventory/rolls' },
    ],
  },
  {
    label: 'Отгрузки',
    icon: 'Truck',
    children: [
      { label: 'Отгрузка от поставщика', path: '/crm/shipments/from-supplier' },
      { label: 'Возврат поставщику', path: '/crm/shipments/return-to-supplier' },
      { label: 'Списание брака', path: '/crm/shipments/defect-writeoff' },
      { label: 'Отгрузка в цех', path: '/crm/shipments/to-workshop' },
      { label: 'Передать брак на склад', path: '/crm/shipments/defect-to-warehouse' },
      { label: 'Поставки в маркетплейс', path: '/crm/shipments/to-marketplace' },
      { label: 'Получение возвратов', path: '/crm/shipments/receive-returns' },
    ],
  },
  {
    label: 'Маркетплейсы',
    icon: 'ShoppingBag',
    children: [
      { label: 'Заказы с маркетплейса', path: '/crm/marketplace/orders' },
      { label: 'Товары для пошива', path: '/crm/marketplace/sewing-items' },
      { label: 'Печать стикеров FBO', path: '/crm/marketplace/fbo-stickers' },
    ],
  },
  { label: 'Финансы', icon: 'Wallet', path: '/crm/finance' },
  {
    label: 'Настройки',
    icon: 'Settings',
    children: [{ label: 'Полки на складе', path: '/crm/settings/shelves' }],
  },
];

const cleanerNav: NavItem[] = [{ label: 'Главная', icon: 'LayoutDashboard', path: '/crm' }];

const adminNav: NavItem[] = [
  { label: 'Главная', icon: 'LayoutDashboard', path: '/crm' },
  {
    label: 'Инвентаризация',
    icon: 'Boxes',
    children: [
      { label: 'Материалы на складе', path: '/crm/inventory/warehouse-materials' },
      { label: 'Материалы в цехе', path: '/crm/inventory/workshop-materials' },
      { label: 'Склад товара', path: '/crm/inventory/goods-warehouse' },
      { label: 'Товар к подбору', path: '/crm/inventory/goods-picking' },
      { label: 'Возвраты на осмотр', path: '/crm/inventory/returns-inspection' },
      { label: 'Инвентаризации', path: '/crm/inventory/stocktakes' },
      { label: 'Рулоны', path: '/crm/inventory/rolls' },
    ],
  },
  {
    label: 'Отгрузки',
    icon: 'Truck',
    children: [
      { label: 'Отгрузка от поставщика', path: '/crm/shipments/from-supplier' },
      { label: 'Возврат поставщику', path: '/crm/shipments/return-to-supplier' },
      { label: 'Списание брака', path: '/crm/shipments/defect-writeoff' },
      { label: 'Отгрузка в цех', path: '/crm/shipments/to-workshop' },
      { label: 'Передать брак на склад', path: '/crm/shipments/defect-to-warehouse' },
      { label: 'Поставки в маркетплейс', path: '/crm/shipments/to-marketplace' },
      { label: 'Получение возвратов', path: '/crm/shipments/receive-returns' },
    ],
  },
  {
    label: 'Маркетплейсы',
    icon: 'ShoppingBag',
    children: [
      { label: 'Заказы с маркетплейса', path: '/crm/marketplace/orders' },
      { label: 'Товары для пошива', path: '/crm/marketplace/sewing-items' },
      { label: 'Печать стикеров FBO', path: '/crm/marketplace/fbo-stickers' },
    ],
  },
  { label: 'Финансы', icon: 'Wallet', path: '/crm/finance' },
  {
    label: 'Смены',
    icon: 'CalendarClock',
    children: [
      { label: 'Цеха', path: '/crm/shifts/workshops' },
      { label: 'Список смен', path: '/crm/shifts/list' },
      { label: 'Календарь смен', path: '/crm/shifts/calendar' },
    ],
  },
  {
    label: 'Настройки',
    icon: 'Settings',
    children: [
      { label: 'Настройки системы', path: '/crm/settings/system' },
      { label: 'Пользователи', path: '/crm/settings/users' },
      { label: 'Материалы', path: '/crm/settings/materials' },
      { label: 'Поставщики', path: '/crm/settings/suppliers' },
      { label: 'Товары на маркетплейсе', path: '/crm/settings/marketplace-items' },
      { label: 'Стикеры товаров', path: '/crm/settings/item-stickers' },
      { label: 'Полки на складе', path: '/crm/settings/shelves' },
      { label: 'Вешалки', path: '/crm/settings/hangers' },
      { label: 'Просмотр логов', path: '/crm/settings/logs' },
    ],
  },
];

export const navByRole: Record<Role, NavItem[]> = {
  sewer: productionNav,
  cutter: productionNav,
  packer: packerNav,
  storekeeper: storekeeperNav,
  cleaner: cleanerNav,
  admin: adminNav,
};