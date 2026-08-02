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

export const ROLL_LOW_STOCK_THRESHOLD = 100;

export { formatDateTime, formatTime } from '@/lib/dateUtils';

export const formatMoney = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });