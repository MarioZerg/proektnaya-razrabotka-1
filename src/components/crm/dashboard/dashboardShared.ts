export interface DashboardWidgetData {
  label: string;
  value: number;
  icon: string;
  tone: 'default' | 'warning' | 'urgent';
  path: string;
}

export const toneStyles: Record<string, string> = {
  default: 'text-foreground',
  warning: 'text-amber-600',
  urgent: 'text-destructive',
};

/** Порог малого остатка рулона для виджета дашборда — меньше 20 пог.м. (только рулоны в п.м.). */
export const ROLL_LOW_STOCK_THRESHOLD = 20;

export { formatDateTime, formatTime } from '@/lib/dateUtils';

export const formatMoney = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });