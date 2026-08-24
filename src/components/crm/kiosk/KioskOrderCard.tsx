import { Card, CardContent } from '@/components/ui/card';
import type { KioskOrder } from '@/lib/kioskApi';
import { printTraceSticker } from '@/lib/printTraceSticker';
import KioskOrderNotices from '@/components/crm/kiosk/KioskOrderNotices';
import KioskOrderDetails from '@/components/crm/kiosk/KioskOrderDetails';
import KioskOrderActions from '@/components/crm/kiosk/KioskOrderActions';

interface Props {
  order: KioskOrder;
  printed: boolean;
  labelRefused: boolean;
  tracePrinted: boolean;
  setTracePrinted: (v: boolean) => void;
  closing: boolean;
  blockedWarning: boolean;
  /** Стикер напечатан, но заказ не закрыт — бросить его уже нельзя. */
  unfinished: boolean;
  onPrint: () => void;
  onClose: () => void;
  onCancel: () => void;
}

/**
 * Карточка отсканированного заказа: что за вещь, чем её пометить и что нажать.
 *
 * Собрана из готовых блоков — предупреждений, данных заказа и кнопок. Отдельным
 * компонентом, чтобы экран терминала не смешивал разметку с работой сканера.
 */
const KioskOrderCard = ({
  order,
  printed,
  labelRefused,
  tracePrinted,
  setTracePrinted,
  closing,
  blockedWarning,
  unfinished,
  onPrint,
  onClose,
  onCancel,
}: Props) => (
  <Card className="border-border shadow-none">
    <CardContent className="space-y-4 pt-6">
      {/* Попытались взять новый заказ, не закрыв текущий. Пишем крупно и
          красным: упаковщица смотрит на экран издалека и всплывашку внизу
          не видит — она уже тянется за следующей вещью. */}
      {blockedWarning && (
        <div className="rounded-md border-2 border-destructive bg-destructive/10 p-4 text-center">
          <p className="text-3xl font-bold text-destructive">Завершите текущий заказ</p>
          <p className="mt-1 text-xl text-muted-foreground">
            Стикер напечатан, но заказ не закрыт. Нажмите «Закрыть заказ» — и только
            потом сканируйте следующий
          </p>
        </div>
      )}
      <KioskOrderNotices order={order} />
      <KioskOrderDetails order={order} />
      <KioskOrderActions
        order={order}
        printed={printed}
        labelRefused={labelRefused}
        tracePrinted={tracePrinted}
        closing={closing}
        onPrintTrace={() => {
          printTraceSticker(order);
          setTracePrinted(true);
        }}
        onPrint={onPrint}
        onClose={onClose}
        // Бросить заказ можно, только пока ярлык НЕ напечатан. После печати
        // вещь уже помечена и физически ушла в пакет — заказ обязан быть
        // закрыт, иначе он навсегда зависнет в стикеровке без начисления.
        cancelBlocked={unfinished}
        onCancel={onCancel}
      />
    </CardContent>
  </Card>
);

export default KioskOrderCard;
