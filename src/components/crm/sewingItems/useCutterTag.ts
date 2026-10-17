import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { logPrintSheet, type Order } from '@/lib/ordersApi';

/** На каких этапах вещь висит в цехе с биркой закройщика — там её и перепечатывают. */
export const CUTTER_TAG_STATUSES = ['На раскрое', 'Стикеровка'];

export const canPrintCutterTag = (o: Order) => CUTTER_TAG_STATUSES.includes(o.sewingStatus);

/**
 * Этикетка закройщика 58×40 под ОДИН заказ.
 *
 * Лист закройщика печатается на весь стек, а бирка теряется у одной вещи: порвалась,
 * упала с вешалки, затёрлась. Раньше ради неё перепечатывали весь стек — двадцать
 * бирок ради одной. Теперь бирка печатается из карточки заказа на раскрое или на
 * стикеровке, с тем же QR, который читает терминал упаковщицы.
 */
export const useCutterTag = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [printingTagId, setPrintingTagId] = useState<number | null>(null);

  const printCutterTag = async (o: Order) => {
    if (!o.orderNumber) return;
    setPrintingTagId(o.id);
    try {
      const { printOrderQrTag } = await import('@/lib/printOrderQrTag');
      await printOrderQrTag({
        orderNumber: o.orderNumber,
        material: o.material,
        width: o.width,
        height: o.height,
        marketplace: o.marketplace,
        orderType: o.orderType,
        hint: 'Этикетка закройщика — крепится к крою',
      });
      // След в журнале, как у листа стека: видно, у какой вещи бирку перепечатывали.
      logPrintSheet([o.id], 'single', user?.id, user?.name);
    } catch (e) {
      toast({
        title: 'Не удалось напечатать этикетку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPrintingTagId(null);
    }
  };

  return { printingTagId, printCutterTag };
};

export default useCutterTag;
