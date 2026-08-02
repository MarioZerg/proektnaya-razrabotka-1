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

export { formatDateTime as formatDate, timeAgo } from '@/lib/dateUtils';

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