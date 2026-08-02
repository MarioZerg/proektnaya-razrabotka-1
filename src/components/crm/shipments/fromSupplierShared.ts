export interface ItemRow {
  materialId: string;
  quantity: string;
  numberRolls: string;
}

export const emptyRow: ItemRow = { materialId: '', quantity: '', numberRolls: '' };

export { formatDateTime as formatDate } from '@/lib/dateUtils';

export const statusVariant: Record<string, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  Новый: 'secondary',
  Завершено: 'default',
  Отклонена: 'destructive',
};