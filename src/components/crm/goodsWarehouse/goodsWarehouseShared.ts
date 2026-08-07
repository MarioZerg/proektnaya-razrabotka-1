import type { GoodsStatus, ReceiveReason } from '@/lib/goodsWarehouseApi';

export { formatDateTime as formatDate } from '@/lib/dateUtils';

export const statusLabels: Record<GoodsStatus, string> = {
  awaiting_shelf: 'Ждёт полку',
  in_stock: 'На хранении',
  picking: 'На сборке',
  reserved: 'Зарезервирован',
  shipped: 'Отгружен',
  lost: 'Утерян',
};

export const statusVariant: Record<GoodsStatus, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  awaiting_shelf: 'destructive',
  in_stock: 'secondary',
  picking: 'default',
  reserved: 'default',
  shipped: 'outline',
  lost: 'destructive',
};

/** Причина попадания товара на склад — чтобы кладовщик понимал происхождение вещи. */
export const reasonLabels: Record<ReceiveReason, string> = {
  cancelled: 'Отмена клиентом',
  return: 'Возврат',
  manual: 'Принят вручную',
  admin: 'Добавил админ',
  individual: 'Индивидуальный пошив',
};

export const reasonIcons: Record<ReceiveReason, string> = {
  cancelled: 'XCircle',
  return: 'Undo2',
  manual: 'Hand',
  admin: 'ShieldCheck',
  individual: 'UserCheck',
};

export const reasonClass: Record<ReceiveReason, string> = {
  cancelled: 'bg-orange-100 text-orange-700 hover:bg-orange-100',
  return: 'bg-sky-100 text-sky-700 hover:bg-sky-100',
  manual: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
  admin: 'bg-violet-100 text-violet-700 hover:bg-violet-100',
  individual: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
};