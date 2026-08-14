import type { Order } from '@/lib/ordersApi';

/** Сколько часов заказ ждёт с момента оформления покупателем на маркетплейсе. */
export const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3600000;

/**
 * Срок, за который вещь обязана уехать: FBS отгружается день в день, FBO едет на склад
 * маркетплейса и терпит дольше.
 */
export const limitFor = (orderType: string) => (orderType === 'FBS' ? 24 : 72);

export type UrgencyTone = 'critical' | 'warning' | 'ok';

export const getTone = (hours: number, orderType: string): UrgencyTone => {
  const limit = limitFor(orderType);
  if (hours >= limit) return 'critical';
  if (hours >= limit * 0.6) return 'warning';
  return 'ok';
};

/**
 * «Красный» заказ — просроченный: время на отгрузку уже вышло, шить надо вне очереди.
 *
 * Раньше это состояние было заперто внутри значка времени: маленький красный бейдж среди
 * прочих легко пропустить, и срочная вещь могла спокойно лежать в общей куче. Отдельная
 * функция нужна, чтобы всю карточку целиком (и строку в таблице) можно было пометить
 * молнией — на неё смотрят и швея на телефоне, и мастер за компьютером.
 */
export const isUrgent = (order: Order): boolean => {
  const source = order.marketplaceCreatedAt || order.createdAt;
  if (!source) return false;
  return getTone(hoursSince(source), order.orderType) === 'critical';
};
