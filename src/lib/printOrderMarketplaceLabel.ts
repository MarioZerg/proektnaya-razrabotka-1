import { printLabelPng, printLabelPdf } from '@/lib/printMarketplaceLabel';
import { fetchWbLabel } from '@/lib/wbFbsApi';
import { fetchOzonLabel } from '@/lib/ozonFbsApi';
import { fetchYandexLabel } from '@/lib/yandexMarketApi';
import { printFboSticker } from '@/lib/printFboSticker';
import { fetchOrderDetail } from '@/lib/ordersApi';

/**
 * Печать стикера отправления по заказу.
 *
 * Стикер берём у маркетплейса, а не рисуем свой: на складе принимают только их
 * этикетку с их кодом, самодельную завернут обратно. У каждой площадки свой формат —
 * WB отдаёт картинку 58×40, OZON и Яндекс присылают PDF.
 *
 * FBO-заказы идут на склад маркетплейса коробками, там этикетка на вещь не нужна —
 * печатаем свой складской стикер.
 */
export const printOrderMarketplaceLabel = async (order: {
  id: number;
  orderNumber: string;
  marketplace?: string | null;
  orderType?: string | null;
}) => {
  const isFbs = (order.orderType || '').toUpperCase() === 'FBS';
  if (!isFbs) {
    printFboSticker(await fetchOrderDetail(order.id));
    return;
  }

  const mp = (order.marketplace || '').toUpperCase();
  if (mp === 'WB' || mp === 'WILDBERRIES') {
    printLabelPng(await fetchWbLabel(order.orderNumber), 'Стикер WB');
    return;
  }
  if (mp === 'OZON') {
    printLabelPdf(await fetchOzonLabel(order.orderNumber), 'Ярлык OZON');
    return;
  }
  if (mp === 'YANDEX' || mp === 'YANDEX_MARKET') {
    printLabelPdf(await fetchYandexLabel(order.orderNumber), 'Ярлык Яндекс Маркета');
    return;
  }
  printFboSticker(await fetchOrderDetail(order.id));
};
