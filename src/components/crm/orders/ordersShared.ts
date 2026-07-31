import type { Marketplace, OrderStatus, OrderType } from '@/lib/ordersApi';

export const productOptions = [
  'Вуаль 200x265',
  'Вуаль 300x255',
  'Вуаль 300x265',
  'Лён 200x265',
  'Шифон 300x255',
];

export const marketplaceLogo: Record<Marketplace, { label: string; className: string }> = {
  OZON: { label: 'OZON', className: 'text-[#005BFF] font-bold' },
  WB: { label: 'Wildberries', className: 'text-[#CB11AB] font-bold' },
  Yandex: { label: 'Яндекс.Маркет', className: 'text-[#FFCC00] font-bold' },
};

export const statusVariant = (
  status: OrderStatus
): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'Выполнен') return 'secondary';
  if (status === 'Отменён') return 'destructive';
  if (status === 'В работе') return 'default';
  return 'outline';
};

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

export const timeAgo = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days > 0) return `${days} дн. ${remHours} час. назад`;
  return `${hours} час. назад`;
};

export interface EditFormState {
  orderNumber: string;
  marketplace: Marketplace;
  orderType: OrderType;
  status: OrderStatus;
  product: string;
}

export const emptyManualForm: EditFormState = {
  orderNumber: '',
  marketplace: 'OZON',
  orderType: 'FBO',
  status: 'Новый',
  product: productOptions[0],
};
