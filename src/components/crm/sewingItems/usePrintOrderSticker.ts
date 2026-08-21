import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { printFboSticker } from '@/lib/printFboSticker';
import type { Order } from '@/lib/ordersApi';

/**
 * Печать стикера готового заказа — из списка вещей.
 *
 * Кладовщику нужна обе схемы:
 *   · FBO — наш складской стикер, рисуем сами;
 *   · FBS — ярлык маркетплейса (OZON, WB, Яндекс), запрашиваем у площадки.
 *
 * FBS раньше отсюда не печатался, и если наклейка потерялась или смазалась,
 * кладовщик шёл искать вещь по складу и печатал из другого раздела. Вещь при
 * этом лежит готовая, а отгрузить её без ярлыка нельзя.
 *
 * Ярлык FBS живёт на стороне маркетплейса, и запрос может не пройти: заказ
 * отменили, площадка молчит. Ошибку показываем — иначе кладовщик будет ждать
 * наклейку, которой не будет.
 */
export const usePrintOrderSticker = () => {
  const { toast } = useToast();
  const [printingId, setPrintingId] = useState<number | null>(null);

  const printSticker = async (o: Order) => {
    setPrintingId(o.id);
    try {
      if ((o.orderType || '').toUpperCase() === 'FBS') {
        const { printOrderMarketplaceLabel } = await import(
          '@/lib/printOrderMarketplaceLabel'
        );
        await printOrderMarketplaceLabel({
          id: o.id,
          orderNumber: o.orderNumber,
          marketplace: o.marketplace,
          orderType: o.orderType,
        });
      } else {
        printFboSticker(o);
      }
    } catch (e) {
      toast({
        title: 'Не удалось напечатать ярлык',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPrintingId(null);
    }
  };

  return { printingId, printSticker };
};

export default usePrintOrderSticker;
