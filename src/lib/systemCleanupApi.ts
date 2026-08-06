const CLEANUP_URL = 'https://functions.poehali.dev/f9bfcdb7-fc84-4632-90e0-7bbb0b3a1457';

/** Точная фраза подтверждения — защита от случайного нажатия. */
export const CONFIRM_PHRASE = 'ОЧИСТИТЬ';

export interface CleanupPreview {
  willDelete: Record<string, number>;
  willKeep: Record<string, number>;
  totalToDelete: number;
}

export interface CleanupResult {
  success: true;
  before: Record<string, number>;
  deleted: Record<string, number>;
  after: Record<string, number>;
  kept: Record<string, number>;
  totalDeleted: number;
}

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(CLEANUP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

/** Показывает, что будет удалено и что останется. Ничего не меняет. */
export const fetchCleanupPreview = (): Promise<CleanupPreview> => post({ action: 'preview' });

/** Выполняет очистку. Нужна точная подтверждающая фраза. */
export const runCleanup = (confirm: string): Promise<CleanupResult> =>
  post({ action: 'cleanup', confirm });

/** Человеческие названия разделов — в интерфейсе не должно быть имён таблиц. */
export const SECTION_LABELS: Record<string, string> = {
  orders: 'Заказы',
  order_material_usage: 'Расход ткани по заказам',
  auto_order_blocks: 'Блокировки автозаказа',
  rolls: 'Рулоны ткани',
  goods_warehouse: 'Готовый товар на складе',
  shipments: 'Отгрузки',
  shipment_items: 'Позиции отгрузок',
  material_defects: 'Брак материала',
  material_movements: 'Движения материала',
  marketplace_supplies: 'Поставки на маркетплейс',
  marketplace_supply_items: 'Позиции поставок',
  marketplace_supply_boxes: 'Короба поставок',
  wb_supply_orders: 'Заказы в поставках WB',
  marketplace_returns: 'Возвраты с маркетплейсов',
  reviews: 'Отзывы',
  salary_accruals: 'Начисления зарплаты',
  salary_payouts: 'Выплаты зарплаты',
  cash_box_transactions: 'Движения по кассе',
  shift_sessions: 'Смены сотрудников',
  audit_log: 'Журнал действий',
  inventory_items: 'Инвентаризация',

  users: 'Сотрудники',
  user_roles: 'Должности сотрудников',
  workshops: 'Цеха',
  workshop_settings: 'Настройки цехов',
  shifts: 'Смены',
  shift_calendar: 'Календарь смен',
  salary_rates: 'Тарифы зарплаты',
  materials: 'Материалы',
  material_types: 'Типы материалов',
  suppliers: 'Поставщики',
  shelves: 'Полки',
  hangers: 'Вешалки',
  marketplace_integrations: 'Ключи маркетплейсов',
  marketplace_items: 'Карточки товаров',
  marketplace_item_materials: 'Нормы расхода ткани',
  system_settings: 'Общие настройки',
};
