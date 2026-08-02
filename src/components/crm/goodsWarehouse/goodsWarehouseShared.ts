import type { GoodsStatus } from '@/lib/goodsWarehouseApi';

export { formatDateTime as formatDate } from '@/lib/dateUtils';

export const statusLabels: Record<GoodsStatus, string> = {
  in_stock: 'На хранении',
  picking: 'На сборке',
  reserved: 'Зарезервирован',
  shipped: 'Отгружен',
  lost: 'Утерян',
};

export const statusVariant: Record<GoodsStatus, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  in_stock: 'secondary',
  picking: 'default',
  reserved: 'default',
  shipped: 'outline',
  lost: 'destructive',
};