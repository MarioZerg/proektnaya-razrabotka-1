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
  /**
   * Выделить пункт в меню. Нужен для «Инструкций»: раздел стоит последним, туда
   * заходят редко, и без подсветки его просто не замечают.
   */
  highlight?: boolean;
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

/**
 * Раздел «Инструкции» — как что делать на производстве.
 *
 * Ставится ПОСЛЕДНИМ пунктом в меню любой роли и подсвечивается: заходят сюда редко,
 * и в середине списка раздел просто теряется. Набор памяток у всех одинаковый —
 * упаковщице полезно знать про рулоны, кладовщику про упаковку.
 */
/**
 * Инструкции и кому они нужны.
 *
 * Показываем сотруднику только то, что относится к его работе: швее незачем читать
 * про приём возвратов, а кладовщику — про перепаковку. Администратор видит всё,
 * потому что отвечает за процессы целиком.
 */
export interface GuideItem {
  label: string;
  path: string;
  /** Роли, которым инструкция полезна. Админ видит все независимо от списка. */
  roles: Role[];
}

const ALL_STOREKEEPERS: Role[] = ['storekeeper', 'senior_storekeeper'];

export const guideItems: GuideItem[] = [
  {
    label: 'Что такое договоры',
    path: '/crm/inventory/contracts-guide',
    // Договор подписывают все без исключения — без подписи система не работает.
    roles: ['sewer', 'cutter', 'packer', 'cleaner', 'manager', ...ALL_STOREKEEPERS],
  },
  {
    label: 'Подбор пакетов',
    path: '/crm/inventory/packaging-guide',
    roles: ['sewer', 'cutter', 'packer', ...ALL_STOREKEEPERS],
  },
  {
    label: 'Инструкция упаковщицы',
    path: '/crm/inventory/packer-guide',
    roles: ['packer', 'sewer'],
  },
  {
    label: 'Как принимать возвраты',
    path: '/crm/inventory/warehouse-guide',
    roles: ALL_STOREKEEPERS,
  },
  {
    label: 'Как работать с рулонами',
    path: '/crm/inventory/rolls-guide',
    roles: ALL_STOREKEEPERS,
  },
  {
    label: 'Крой продукции',
    path: '/crm/inventory/cutting-guide',
    roles: ['cutter'],
  },
  {
    label: 'Работа с браком из цеха',
    path: '/crm/inventory/defect-guide',
    roles: ALL_STOREKEEPERS,
  },
  {
    label: 'Работа с FBO и FBS',
    path: '/crm/inventory/fbo-fbs-guide',
    roles: [...ALL_STOREKEEPERS, 'manager'],
  },
  {
    label: 'Подбор товара со склада',
    path: '/crm/inventory/picking-guide',
    roles: ALL_STOREKEEPERS,
  },
  {
    label: 'Назначение статусов',
    path: '/crm/inventory/statuses-guide',
    roles: ALL_STOREKEEPERS,
  },
  {
    label: 'Штрафы и удержания',
    path: '/crm/inventory/penalties-guide',
    roles: ['sewer', 'cutter', ...ALL_STOREKEEPERS],
  },
  {
    label: 'Завершение сотрудничества',
    path: '/crm/inventory/termination-guide',
    // Касается всех исполнителей: условия договора одинаковые для любой роли.
    roles: ['sewer', 'cutter', 'packer', 'cleaner', 'manager', ...ALL_STOREKEEPERS],
  },
];

/** Раздел «Инструкции» для конкретной роли. Админу — весь список. */
const buildGuidesNav = (role: Role): NavItem => ({
  label: 'Инструкции',
  icon: 'CircleAlert',
  highlight: true,
  children: guideItems
    .filter((g) => role === 'admin' || g.roles.includes(role))
    .map((g) => ({ label: g.label, path: g.path })),
});

const productionNav: NavItem[] = [
  { label: 'Главная', icon: 'LayoutDashboard', path: '/crm' },
  // Магазин вариков — только витрина: производственные роли копят варики за смены
  // и тратят их на подарки. Управление магазином остаётся у администратора.
  { label: 'Магазин вариков', icon: 'Gift', path: '/crm/variki/shop' },
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
  // Магазин вариков — только витрина: производственные роли копят варики за смены
  // и тратят их на подарки. Управление магазином остаётся у администратора.
  { label: 'Магазин вариков', icon: 'Gift', path: '/crm/variki/shop' },
  // Подбор пакетов — ежедневный инструмент упаковщицы, поэтому остаётся отдельным
  // пунктом верхнего уровня, а не прячется внутри «Инструкций».
  { label: 'Подбор пакетов', icon: 'Package', path: '/crm/inventory/packaging-guide' },
  // Осмотр возвратов из личного кабинета убран намеренно — как и терминал стикеровки:
  // упаковщица осматривает вещи на планшете в цехе, где под рукой сканер, принтер
  // стикеров и сами вещи. С компьютера эта работа всё равно не делается: вещь нужно
  // держать в руках. Экран остаётся на киоске (плитка «Перепаковка»).
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
      { label: 'Приём брака из цеха', path: '/crm/inventory/defect-receive' },
      { label: 'Рулоны', path: '/crm/inventory/rolls' },
      // Аналитика (недостачи, возвраты, брак) убрана: это разбор движения товара и
      // решения по нему — работа руководителя, а не кладовщика. Его дело — принять
      // вещь, положить на полку и отгрузить.
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
      { label: 'Поставка в маркет', path: '/crm/shipments/to-marketplace' },
      // «Приём возвратов» убран: там видно всё движение возврата и принимаются решения
      // по нему. Кладовщику это не нужно — он забирает вещи по кодам для ПВЗ и заводит
      // их на склад кнопкой «Привёз с пункта выдачи» на складе товара.
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
      // «Отзывы» убраны: работа с репутацией — не склад.
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
    children: [{ label: 'Поставка в маркет', path: '/crm/shipments/to-marketplace' }],
  },
  {
    label: 'Маркетплейсы',
    icon: 'ShoppingBag',
    children: [
      { label: 'Заказы с маркетплейса', path: '/crm/marketplace/orders' },
      { label: 'Товары для пошива', path: '/crm/marketplace/sewing-items' },
      { label: 'Отзывы', path: '/crm/marketplace/reviews' },
      // Отказы покупателей — работа менеджера: он оспаривает отмены на площадке
      // и видит, какой товар возвращают чаще других.
      { label: 'Анализ отмен', path: '/crm/marketplace/cancellations' },
    ],
  },
  { label: 'Договоры', icon: 'FileSignature', path: '/crm/contracts' },
  // Финансы менеджера — это не цеховая сдельщина, а процент с денег, пришедших
  // на счёт по недельным отчётам площадки. Экран у него свой.
  { label: 'Финансы', icon: 'Wallet', path: '/crm/finance' },
  // Выкупы менеджеру нужны прямо в работе: он ведёт продажи и должен видеть,
  // что покупатели забирают и сколько на этом остаётся.
  { label: 'Выкупы', icon: 'ShoppingBag', path: '/crm/finance/buyouts' },
  // Менеджер видит себестоимость, но не правит: он торгуется с площадками и
  // должен знать, ниже какой цены продавать нельзя. Менять налог, тарифы и
  // статьи расходов — решение владельца.
  {
    label: 'Себестоимость товаров',
    icon: 'Calculator',
    path: '/crm/analytics/product-cost',
  },
  // Юнит-экономика менеджеру временно закрыта: расчёт ещё донастраивается, и
  // решения по ценам по нему принимать рано. Пункт вернём, когда цифры устоятся.
];

const adminNav: NavItem[] = [
  { label: 'Главная', icon: 'LayoutDashboard', path: '/crm' },
  // Помощник по системе — спросить про заказы, склад и деньги обычными словами.
  // Только у админа: он видит зарплаты и выручку, цеху это открывать нельзя.
  { label: 'Помощник', icon: 'Sparkles', path: '/crm/assistant' },
  // У админа полный раздел: витрина (посмотреть глазами сотрудника) и управление
  // подарками. Сотрудникам открыта только витрина.
  {
    label: 'Магазин вариков',
    icon: 'Gift',
    children: [
      { label: 'Витрина', path: '/crm/variki/shop' },
      { label: 'Управление магазином', path: '/crm/variki/manage' },
    ],
  },
  {
    label: 'Инвентаризация',
    icon: 'Boxes',
    children: [
      { label: 'Материалы на складе', path: '/crm/inventory/warehouse-materials' },
      { label: 'Материалы в цехе', path: '/crm/inventory/workshop-materials' },
      { label: 'Склад товара', path: '/crm/inventory/goods-warehouse' },
      // «Товар к подбору» и инструкции убраны из меню: подбор открывается кнопкой
      // со склада товара, инструкции собраны в отдельном разделе «Инструкции».
      { label: 'Приём брака из цеха', path: '/crm/inventory/defect-receive' },
      { label: 'Рулоны', path: '/crm/inventory/rolls' },
      { label: 'Анализ недостач', path: '/crm/analytics/roll-shortage' },
      { label: 'Анализ возвратов', path: '/crm/analytics/returns' },
      { label: 'Анализ брака', path: '/crm/analytics/defects' },
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
      { label: 'Поставка в маркет', path: '/crm/shipments/to-marketplace' },
      { label: 'Приём возвратов', path: '/crm/shipments/receive-returns' },
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
      { label: 'Анализ отмен', path: '/crm/marketplace/cancellations' },
    ],
  },
  { label: 'Договоры', icon: 'FileSignature', path: '/crm/contracts' },
  {
    label: 'Финансы',
    icon: 'Wallet',
    children: [
      { label: 'Зарплаты и касса', path: '/crm/finance' },
      // Выкупы — деньги, которые уже наши: что покупатели забрали и сколько
      // на этом заработано. Товар в доставке ещё может вернуться, поэтому
      // сюда попадают только выкупленные заказы.
      { label: 'Выкупы', path: '/crm/finance/buyouts' },
      // Себестоимость — деньги, а не склад: сколько стоит одна вещь и из чего
      // складывается её цена. Смотрит только владелец.
      { label: 'Себестоимость товаров', path: '/crm/analytics/product-cost' },
      { label: 'Юнит-экономика маркетплейсов', path: '/crm/analytics/unit-economics' },
      // Продвижение — следующий шаг после экономики: что делать с ценами,
      // чтобы маржа пришла к цели, и в какие акции идти.
      { label: 'Продвижение', path: '/crm/analytics/promotion' },
    ],
  },
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
      { label: 'Реквизиты ИП', path: '/crm/settings/company' },
      { label: 'Материалы', path: '/crm/settings/materials' },
      { label: 'Поставщики', path: '/crm/settings/suppliers' },
      { label: 'Товары на маркетплейсе', path: '/crm/settings/marketplace-items' },
      { label: 'Интеграции маркетплейсов', path: '/crm/settings/marketplace-integrations' },
      { label: 'Планировщик', path: '/crm/settings/scheduler' },
      { label: 'Полки на складе', path: '/crm/settings/shelves' },
      { label: 'Вешалки', path: '/crm/settings/hangers' },
      { label: 'Журнал действий', path: '/crm/settings/logs' },
    ],
  },
];

const baseNavByRole: Record<Role, NavItem[]> = {
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

/**
 * Меню роли. «Инструкции» добавляются последним пунктом и собираются под роль:
 * человек видит только те памятки, что относятся к его работе.
 */
/**
 * Чат доступен ВСЕМ без исключения — это общая переписка компании, а не раздел
 * какого-то отдела. Поэтому добавляется в меню всем ролям одинаково, сразу после
 * главной: рабочие вопросы задают чаще, чем открывают справочники.
 */
const chatNavItem: NavItem = { label: 'Чат', icon: 'MessagesSquare', path: '/crm/chat' };

export const navByRole: Record<Role, NavItem[]> = Object.fromEntries(
  (Object.keys(baseNavByRole) as Role[]).map((role) => {
    const guides = buildGuidesNav(role);
    // Чат ставим вторым пунктом — сразу после «Главной».
    const base = baseNavByRole[role];
    const withChat = [base[0], chatNavItem, ...base.slice(1)];
    return [role, guides.children?.length ? [...withChat, guides] : withChat];
  }),
) as Record<Role, NavItem[]>;