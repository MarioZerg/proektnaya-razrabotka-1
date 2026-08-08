import type { Order } from '@/lib/ordersApi';

export interface DuplicatePosting {
  /** Номер отправления OZON, в котором нашлось задвоение. */
  postingNumber: string;
  /** Номера заказов, которые относятся к этому отправлению. */
  orderNumbers: string[];
}

/**
 * Ищет задвоенные заказы OZON — когда одна и та же вещь попала в систему дважды.
 *
 * Как отличить задвоение от нормального отправления с несколькими вещами:
 * номера вещей одного отправления всегда сделаны по одному образцу. Раньше в номер
 * подставлялся артикул товара («…-vyal3_265-1»), сейчас — только порядковый номер
 * («…-1») или номер отправления как есть. Если внутри ОДНОГО отправления встречаются
 * оба образца сразу — значит вещи заехали повторно после смены формата номера.
 * Отправление, где все номера сделаны одинаково, — нормальный заказ на несколько вещей.
 *
 * Отменённые заказы не считаем: их уже погасили, на производство они не попадут.
 */
export const findDuplicateOrders = (orders: Order[]): DuplicatePosting[] => {
  const byPosting = new Map<string, Order[]>();

  for (const o of orders) {
    if (o.marketplace !== 'OZON') continue;
    if (o.status === 'Отменён') continue;
    const posting = o.ozonPostingNumber;
    if (!posting) continue;
    const list = byPosting.get(posting);
    if (list) list.push(o);
    else byPosting.set(posting, [o]);
  }

  const result: DuplicatePosting[] = [];
  for (const [postingNumber, list] of byPosting) {
    if (list.length < 2) continue;
    // Артикул в номере всегда содержит подчёркивание — по нему и различаем образцы.
    const withArticle = list.filter((o) => o.orderNumber.includes('_'));
    if (withArticle.length > 0 && withArticle.length < list.length) {
      result.push({
        postingNumber,
        orderNumbers: list.map((o) => o.orderNumber).sort(),
      });
    }
  }

  return result;
};

/** Сколько лишних вещей числится сверх нужного — столько заказов нужно отменить. */
export const countDuplicateOrders = (orders: Order[]): number =>
  findDuplicateOrders(orders).reduce((sum, d) => sum + d.orderNumbers.length - 1, 0);
