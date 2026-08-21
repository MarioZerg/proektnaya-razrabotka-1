import { printLabelPng, printLabelPdf } from '@/lib/printMarketplaceLabel';
import { fetchWbLabel } from '@/lib/wbFbsApi';
import { fetchOzonLabel } from '@/lib/ozonFbsApi';
import { fetchYandexLabelFull } from '@/lib/yandexMarketApi';
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
    await printLabelPdf(await fetchOzonLabel(order.orderNumber), 'Ярлык OZON');
    return;
  }
  if (mp === 'YANDEX' || mp === 'YANDEX_MARKET') {
    // Ярлык Яндекса вертикальный (40×58) и на нашу наклейку 58×40 целиком не
    // ложится: половина оставалась пустой, а QR ужимался до нечитаемого. Здесь
    // он пересобирается под наклейку — коды берутся с оригинала как есть.
    const { pdfBase64, labelInfo } = await fetchYandexLabelFull(order.orderNumber);
    const { printYandexLabel58x40 } = await import('@/lib/printYandexLabel');
    await printYandexLabel58x40(pdfBase64, {
      orderId: labelInfo?.orderId || order.orderNumber,
      placeNumber: labelInfo?.placeNumber || order.orderNumber,
      placeIndex: labelInfo?.placeIndex || '',
    });
    return;
  }
  printFboSticker(await fetchOrderDetail(order.id));
};
