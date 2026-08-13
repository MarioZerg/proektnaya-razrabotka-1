import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { KioskOrder } from '@/lib/kioskApi';

interface KioskOrderActionsProps {
  order: KioskOrder;
  printed: boolean;
  tracePrinted: boolean;
  closing: boolean;
  onPrintTrace: () => void;
  onPrint: () => void;
  onClose: () => void;
  onCancel: () => void;
}

/**
 * Кнопки терминала: печать стикеров, закрытие заказа и отмена.
 *
 * Кнопки крупные (высотой 64px) — упаковщица работает пальцами, часто в перчатках,
 * и смотрит на экран с расстояния вытянутой руки.
 */
const KioskOrderActions = ({
  order,
  printed,
  tracePrinted,
  closing,
  onPrintTrace,
  onPrint,
  onClose,
  onCancel,
}: KioskOrderActionsProps) => (
  <>
    {/* Стикер «кто шил» нужен только на FBO: там вещь уезжает на склад
        маркетплейса обезличенной, и по возврату иначе не понять, чья работа.
        У FBS в пакет кладётся ярлык отправления маркетплейса, заказ привязан
        к конкретному покупателю — второй стикер только путает упаковщицу. */}
    {order.orderType !== 'FBS' && (
      <Button
        size="lg"
        variant={tracePrinted ? 'outline' : 'default'}
        className="h-16 w-full text-lg"
        onClick={onPrintTrace}
      >
        <Icon name={tracePrinted ? 'Check' : 'QrCode'} size={24} className="mr-2" />
        {tracePrinted ? 'Стикер в пакет напечатан' : 'Стикер в пакет (кто шил)'}
      </Button>
    )}

    {order.isCancelled || order.labelGone ? (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-center">
        <p className="text-lg font-bold text-destructive">
          {order.labelGone && !order.isCancelled
            ? 'Отправление уже уехало к покупателю'
            : 'Клиент отменил заказ'}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {order.labelGone && !order.isCancelled
            ? 'Маркетплейс больше не выдаёт ярлык на это отправление. Нажмите «Закрыть заказ» — распечатается стикер хранения, наклейте его и оставьте вещь для кладовщика'
            : 'Стикер отправления не нужен. Нажмите «Закрыть заказ» — распечатается стикер хранения, наклейте его и оставьте вещь для кладовщика'}
        </p>
        {/* Связка Яндекса: у заказа один ярлык на несколько вещей, поэтому
            отмена касается всей связки. Упаковщица стикерует вещи по очереди,
            но должна знать общее число — чтобы не потерять часть. */}
        {order.groupKey && (order.groupSize || 0) > 1 && (
          <p className="mt-2 rounded-md border border-destructive/40 bg-background px-3 py-1.5 text-sm font-semibold">
            Это связка: всего вещей {order.groupSize}, эта —{' '}
            {order.groupPosition || 1}. Стикеруйте по очереди и держите их вместе
          </p>
        )}
      </div>
    ) : (
      <Button size="lg" className="h-16 w-full text-lg" onClick={onPrint}>
        <Icon name="Printer" size={24} className="mr-2" />
        {order.orderType === 'FBS'
          ? 'Распечатать ярлык отправления'
          : 'Распечатать стикер'}
      </Button>
    )}

    {(printed || order.isCancelled || order.labelGone) && (
      <Button
        size="lg"
        className="h-16 w-full bg-emerald-600 text-lg text-white hover:bg-emerald-700"
        onClick={onClose}
        disabled={closing}
      >
        <Icon
          name={closing ? 'Loader2' : 'Check'}
          size={24}
          className={`mr-2 ${closing ? 'animate-spin' : ''}`}
        />
        Закрыть заказ
      </Button>
    )}

    <Button variant="outline" size="lg" className="h-14 w-full" onClick={onCancel}>
      Отмена
    </Button>
  </>
);

export default KioskOrderActions;
