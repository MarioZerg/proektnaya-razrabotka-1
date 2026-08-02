import type { GoodsStatus } from '@/lib/goodsWarehouseApi';

export const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

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
