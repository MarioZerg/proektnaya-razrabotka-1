export type Role =
  | 'sewer'
  | 'cutter'
  | 'packer'
  | 'storekeeper'
  | 'senior_storekeeper'
  | 'cleaner'
  | 'admin'
  | 'manager';

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
  // Менеджер работает с поставками маркетплейса — относим к складской зоне (доступ к отгрузкам).
  // Старший кладовщик работает наравне с обычным — та же складская зона.
  if (role === 'storekeeper' || role === 'senior_storekeeper' || role === 'manager')
    return 'warehouse';
  if (role === 'sewer' || role === 'cutter' || role === 'packer') return 'workshop';
  return 'none';
};

/**
 * Кладовщик — обычный или старший.
 *
 * Старший кладовщик отличается от обычного ТОЛЬКО ставками в тарифах: прав, страниц
 * и кнопок у них поровну. Поэтому везде, где раньше проверялась роль 'storekeeper',
 * теперь используется эта функция — иначе при добавлении роли часть возможностей
 * незаметно осталась бы недоступной старшему.
 */
export const isStorekeeperRole = (role: Role | undefined | null): boolean =>
  role === 'storekeeper' || role === 'senior_storekeeper';

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
  senior_storekeeper: 'Старший кладовщик',
  cleaner: 'Уборщица',
  admin: 'Администратор',
  manager: 'Менеджер',
};

const productionNav: NavItem[] = [
  { label: 'Главная', icon: 'LayoutDashboard', path: '/crm' },
  {
    label: 'Инвентаризация',
    icon: 'Boxes',
    // Рулоны производственным ролям показываем только своего цеха (фильтрация на бэкенде),
    // чтобы швея/закройщик/упаковщик видели остатки, с которыми реально работают.
    children: [
      { label: 'Материалы в цехе', path: '/crm/inventory/workshop-materials' },
      { label: 'Рулоны', path: '/crm/inventory/rolls' },
    ],
  },
  {
    label: 'Отгрузки',
    icon: 'Truck',
    children: [
      { label: 'Отгрузка в цех', path: '/crm/shipments/to-workshop' },
    ],
  },
  {
    label: 'Маркетплейсы',
    icon: 'ShoppingBag',
    children: [{ label: 'Товары для пошива', path: '/crm/marketplace/sewing-items' }],
  },
  { label: 'Договоры', icon: 'FileSignature', path: '/crm/contracts' },
  { label: 'Финансы', icon: 'Wallet', path: '/crm/finance' },
];

const packerNav: NavItem[] = [
  { label: 'Главная', icon: 'LayoutDashboard', path: '/crm' },
  // Подбор пакетов — ежедневный инструмент упаковщицы, поэтому остаётся отдельным
  // пунктом верхнего уровня, а не прячется внутри «Инструкций».
  { label: 'Подбор пакетов', icon: 'Package', path: '/crm/inventory/packaging-guide' },
  {
    label: 'Инструкции',
    icon: 'BookOpen',
    children: [
      { label: 'Инструкция упаковщицы', path: '/crm/inventory/packer-guide' },
      { label: 'Подбор пакетов', path: '/crm/inventory/packaging-guide' },
    ],
  },
  {
    label: 'Инвентаризация',
    icon: 'Boxes',
    // Рулоны производственным ролям показываем только своего цеха (фильтрация на бэкенде),
    // чтобы швея/закройщик/упаковщик видели остатки, с которыми реально работают.
    children: [
      { label: 'Материалы в цехе', path: '/crm/inventory/workshop-materials' },
      { label: 'Рулоны', path: '/crm/inventory/rolls' },
    ],
  },
  {
    label: 'Отгрузки',
    icon: 'Truck',
    children: [
      { label: 'Отгрузка в цех', path: '/crm/shipments/to-workshop' },
    ],
  },
  {
    label: 'Маркетплейсы',
    icon: 'ShoppingBag',
    children: [{ label: 'Товары для пошива', path: '/crm/marketplace/sewing-items' }],
  },
  // Терминал стикеровки из личного кабинета убран намеренно: упаковщица работает
  // только на киоске в цехе (планшет), а не через свой личный кабинет.
  { label: 'Договоры', icon: 'FileSignature', path: '/crm/contracts' },
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
      // «Товар к подбору» и инструкции убраны из меню: подбор открывается кнопкой
      // со склада товара, инструкции собраны в отдельном разделе «Инструкции».
      { label: 'Инвентаризации', path: '/crm/inventory/stocktakes' },
      { label: 'Рулоны', path: '/crm/inventory/rolls' },
      { label: 'Анализ недостач', path: '/crm/analytics/roll-shortage' },
      { label: 'Анализ возвратов', path: '/crm/analytics/returns' },
      { label: 'Анализ брака', path: '/crm/analytics/defects' },
    ],
  },
  {
    // Всё «как делать» в одном месте — чтобы не искать инструкции по разделам.
    label: 'Инструкции',
    icon: 'BookOpen',
    children: [
      { label: 'Как принимать возвраты', path: '/crm/inventory/warehouse-guide' },
      { label: 'Как работать с рулонами', path: '/crm/inventory/rolls-guide' },
      { label: 'Инструкция упаковщицы', path: '/crm/inventory/packer-guide' },
      { label: 'Подбор пакетов', path: '/crm/inventory/packaging-guide' },
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
      { label: 'Поставки в маркетплейс', path: '/crm/shipments/to-marketplace' },
      { label: 'Получение возвратов', path: '/crm/shipments/receive-returns' },
      // Штрихкоды продавца: без них возвраты на ПВЗ не выдают.
      { label: 'Коды для ПВЗ', path: '/crm/shipments/return-codes' },
    ],
  },
  {
    label: 'Маркетплейсы',
    icon: 'ShoppingBag',
    children: [
      { label: 'Заказы с маркетплейса', path: '/crm/marketplace/orders' },
      { label: 'Товары для пошива', path: '/crm/marketplace/sewing-items' },
      { label: 'Отзывы', path: '/crm/marketplace/reviews' },
    ],
  },
  { label: 'Договоры', icon: 'FileSignature', path: '/crm/contracts' },
  { label: 'Финансы', icon: 'Wallet', path: '/crm/finance' },
  {
    label: 'Настройки',
    icon: 'Settings',
    children: [{ label: 'Полки на складе', path: '/crm/settings/shelves' }],
  },
];

const cleanerNav: NavItem[] = [
  { label: 'Главная', icon: 'LayoutDashboard', path: '/crm' },
  { label: 'Договоры', icon: 'FileSignature', path: '/crm/contracts' },
];

// Менеджер: работа с заказами и поставками маркетплейса (в т.ч. заявки OZON FBO).
const managerNav: NavItem[] = [
  { label: 'Главная', icon: 'LayoutDashboard', path: '/crm' },
  {
    label: 'Отгрузки',
    icon: 'Truck',
    children: [{ label: 'Поставки в маркетплейс', path: '/crm/shipments/to-marketplace' }],
  },
  {
    label: 'Маркетплейсы',
    icon: 'ShoppingBag',
    children: [
      { label: 'Заказы с маркетплейса', path: '/crm/marketplace/orders' },
      { label: 'Товары для пошива', path: '/crm/marketplace/sewing-items' },
      { label: 'Отзывы', path: '/crm/marketplace/reviews' },
    ],
  },
  { label: 'Договоры', icon: 'FileSignature', path: '/crm/contracts' },
];

const adminNav: NavItem[] = [
  { label: 'Главная', icon: 'LayoutDashboard', path: '/crm' },
  {
    label: 'Инвентаризация',
    icon: 'Boxes',
    children: [
      { label: 'Материалы на складе', path: '/crm/inventory/warehouse-materials' },
      { label: 'Материалы в цехе', path: '/crm/inventory/workshop-materials' },
      { label: 'Склад товара', path: '/crm/inventory/goods-warehouse' },
      // «Товар к подбору» и инструкции убраны из меню: подбор открывается кнопкой
      // со склада товара, инструкции собраны в отдельном разделе «Инструкции».
      { label: 'Инвентаризации', path: '/crm/inventory/stocktakes' },
      { label: 'Рулоны', path: '/crm/inventory/rolls' },
      { label: 'Анализ недостач', path: '/crm/analytics/roll-shortage' },
      { label: 'Анализ возвратов', path: '/crm/analytics/returns' },
      { label: 'Анализ брака', path: '/crm/analytics/defects' },
    ],
  },
  {
    // Всё «как делать» в одном месте — чтобы не искать инструкции по разделам.
    label: 'Инструкции',
    icon: 'BookOpen',
    children: [
      { label: 'Как принимать возвраты', path: '/crm/inventory/warehouse-guide' },
      { label: 'Как работать с рулонами', path: '/crm/inventory/rolls-guide' },
      { label: 'Инструкция упаковщицы', path: '/crm/inventory/packer-guide' },
      { label: 'Подбор пакетов', path: '/crm/inventory/packaging-guide' },
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
      { label: 'Поставки в маркетплейс', path: '/crm/shipments/to-marketplace' },
      { label: 'Получение возвратов', path: '/crm/shipments/receive-returns' },
      // Штрихкоды продавца: без них возвраты на ПВЗ не выдают.
      { label: 'Коды для ПВЗ', path: '/crm/shipments/return-codes' },
    ],
  },
  {
    label: 'Маркетплейсы',
    icon: 'ShoppingBag',
    children: [
      { label: 'Заказы с маркетплейса', path: '/crm/marketplace/orders' },
      { label: 'Товары для пошива', path: '/crm/marketplace/sewing-items' },
      { label: 'Отзывы', path: '/crm/marketplace/reviews' },
    ],
  },
  { label: 'Договоры', icon: 'FileSignature', path: '/crm/contracts' },
  { label: 'Финансы', icon: 'Wallet', path: '/crm/finance' },
  {
    label: 'Смены',
    icon: 'CalendarClock',
    children: [
      { label: 'Цеха', path: '/crm/shifts/workshops' },
      { label: 'Список смен', path: '/crm/shifts/list' },
      { label: 'Календарь смен', path: '/crm/shifts/calendar' },
      { label: 'Гостевые смены', path: '/crm/shifts/guests' },
    ],
  },
  {
    label: 'Настройки',
    icon: 'Settings',
    children: [
      { label: 'Пользователи', path: '/crm/settings/users' },
      { label: 'Новые сотрудники', path: '/crm/settings/pending-employees' },
      { label: 'Материалы', path: '/crm/settings/materials' },
      { label: 'Поставщики', path: '/crm/settings/suppliers' },
      { label: 'Товары на маркетплейсе', path: '/crm/settings/marketplace-items' },
      { label: 'Интеграции маркетплейсов', path: '/crm/settings/marketplace-integrations' },
      { label: 'Полки на складе', path: '/crm/settings/shelves' },
      { label: 'Вешалки', path: '/crm/settings/hangers' },
    ],
  },
];

export const navByRole: Record<Role, NavItem[]> = {
  sewer: productionNav,
  cutter: productionNav,
  packer: packerNav,
  storekeeper: storekeeperNav,
  // Права у старшего кладовщика те же, что у обычного — отличаются только ставки
  // в тарифах, поэтому меню переиспользуем как есть.
  senior_storekeeper: storekeeperNav,
  cleaner: cleanerNav,
  admin: adminNav,
  manager: managerNav,
};