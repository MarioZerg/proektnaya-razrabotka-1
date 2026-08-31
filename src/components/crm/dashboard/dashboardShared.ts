export interface DashboardWidgetData {
  label: string;
  value: number;
  icon: string;
  tone: 'default' | 'warning' | 'urgent';
  path: string;
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