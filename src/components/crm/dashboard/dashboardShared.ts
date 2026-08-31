/**
 * Этап производственного пути, к которому относится показатель.
 *
 * Плитки на дашборде стояли в том порядке, в каком их когда-то добавляли:
 * пошив, потом поставки материала, потом снова раскрой. Глаз каждый раз искал
 * нужную заново. Расставляем их по ходу дела — как вещь и правда движется по
 * цеху: пришёл заказ → приехал материал → раскрой → пошив → стикеровка →
 * отгрузка → возвраты.
 */
export type DashboardStage =
  | 'attention'
  | 'orders'
  | 'material'
  | 'cutting'
  | 'sewing'
  | 'stickering'
  | 'shipping'
  | 'returns';

/** Заголовки групп и их порядок на дашборде. */
export const STAGE_ORDER: { key: DashboardStage; title: string; icon: string }[] = [
  { key: 'attention', title: 'Требует внимания', icon: 'TriangleAlert' },
  { key: 'orders', title: 'Заказы поступили', icon: 'Inbox' },
  { key: 'material', title: 'Материал', icon: 'Truck' },
  { key: 'cutting', title: 'Раскрой', icon: 'Scissors' },
  { key: 'sewing', title: 'Пошив', icon: 'Shirt' },
  { key: 'stickering', title: 'Стикеровка', icon: 'Tag' },
  { key: 'shipping', title: 'Склад и отгрузка', icon: 'PackageCheck' },
  { key: 'returns', title: 'Возвраты', icon: 'Undo2' },
];

export interface DashboardWidgetData {
  label: string;
  value: number;
  icon: string;
  tone: 'default' | 'warning' | 'urgent';
  path: string;
  /** Этап производства — определяет, в какую группу попадёт плитка. */
  stage: DashboardStage;
  /**
   * Короткая подпись под заголовком: что это за цифра и что с ней делать. Из одного
   * названия это не всегда понятно — «Раскроено» не говорит, ждёт ли работа
   * человека или это просто итог за день.
   */
  hint?: string;
}

/** Порог малого остатка рулона для виджета дашборда — меньше 20 пог.м. (только рулоны в п.м.). */
export const ROLL_LOW_STOCK_THRESHOLD = 20;

export { formatDateTime, formatTime } from '@/lib/dateUtils';

export const formatMoney = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });