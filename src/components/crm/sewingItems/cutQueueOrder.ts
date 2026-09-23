import type { Order } from '@/lib/ordersApi';

/**
 * ПОРЯДОК ОЧЕРЕДИ НА РАСКРОЙ — ТА ЖЕ ЛОГИКА, ЧТО И ПРИ ВЫДАЧЕ СТЕКА.
 *
 * Повторяет правило с сервера (backend/orders/shared.py, cut_queue_order_sql).
 * Держать их одинаковыми обязательно: закройщик смотрит на список и жмёт
 * «Взять стек». Разойдись порядок — на экране одно, в руках другое, и доверие
 * к очереди теряется сразу.
 */

/** Ткани, которые рвутся по нитке: надрезал, дёрнул — готово, счёт на минуты. */
export const FAST_TEAR_MATERIALS = ['Вуаль', 'Бамбук', 'Молния', 'Лен', 'Шифон'];

/** Ткани только под ножницы: режутся по всей длине, одна вещь — долго. */
export const SLOW_CUT_MATERIALS = ['Сетка', 'Мрамор'];

/** Со скольких суток заказ перестаёт уступать очередь. */
export const CUT_OVERDUE_DAYS = 2;

const OVERDUE_MS = CUT_OVERDUE_DAYS * 24 * 60 * 60 * 1000;

/** Дата заказа у покупателя; для ручных заказов — дата создания у нас. */
const orderDate = (o: Order): number =>
  new Date(o.marketplaceCreatedAt || o.createdAt).getTime();

/** Заказ ждёт дольше двух суток — дальше пропускать его вперёд нельзя. */
export const isOverdueForCut = (o: Order): boolean =>
  Date.now() - orderDate(o) > OVERDUE_MS;

/**
 * Уровень скорости раскроя: 0 — рвётся, 1 — обычная ткань, 2 — под ножницы.
 *
 * У залежавшихся заказов ткань на порядок не влияет вовсе — иначе двухдневная
 * сетка продолжала бы пропускать вперёд свежую вуаль и не доходила бы до
 * раскроя никогда.
 */
export const cutSpeedRank = (o: Order): number => {
  if (isOverdueForCut(o)) return 0;
  const m = o.material || '';
  if (FAST_TEAR_MATERIALS.includes(m)) return 0;
  if (SLOW_CUT_MATERIALS.includes(m)) return 2;
  return 1;
};

/**
 * Сравнение двух заказов в очереди на раскрой.
 *
 * Уровни сверху вниз: залежавшиеся → FBS → скорость раскроя → дата заказа.
 */
export const compareCutQueue = (a: Order, b: Order): number => {
  const overdue = Number(isOverdueForCut(b)) - Number(isOverdueForCut(a));
  if (overdue !== 0) return overdue;

  const fbs = Number(b.orderType === 'FBS') - Number(a.orderType === 'FBS');
  if (fbs !== 0) return fbs;

  const speed = cutSpeedRank(a) - cutSpeedRank(b);
  if (speed !== 0) return speed;

  return orderDate(a) - orderDate(b);
};

export default compareCutQueue;
