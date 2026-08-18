import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { KioskOrder } from '@/lib/kioskApi';

interface KioskOrderActionsProps {
  order: KioskOrder;
  printed: boolean;
  /** Маркетплейс реально отказал в ярлыке — вещь идёт на склад хранения. */
  labelRefused?: boolean;
  tracePrinted: boolean;
  closing: boolean;
  onPrintTrace: () => void;
  onPrint: () => void;
  onClose: () => void;
  onCancel: () => void;
  /** Ярлык уже напечатан — бросить заказ нельзя, его обязательно нужно закрыть. */
  cancelBlocked?: boolean;
}

/**
 * Кнопки терминала: печать стикеров, закрытие заказа и отмена.
 *
 * Кнопки крупные (высотой 80px, текст 2xl) — упаковщица работает пальцами, часто
 * в перчатках, и смотрит на экран с расстояния вытянутой руки. Мелкую кнопку она
 * промахивает и не читает, поэтому здесь размер важнее компактности.
 */
const KioskOrderActions = ({
  order,
  printed,
  labelRefused = false,
  tracePrinted,
  closing,
  onPrintTrace,
  onPrint,
  onClose,
  onCancel,
  cancelBlocked = false,
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
        className="h-20 w-full text-2xl font-semibold"
        onClick={onPrintTrace}
      >
        <Icon name={tracePrinted ? 'Check' : 'QrCode'} size={30} className="mr-3" />
        {tracePrinted ? 'Стикер в пакет напечатан' : 'Стикер в пакет (кто шил)'}
      </Button>
    )}

    {order.isCancelled || labelRefused ? (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-center">
        <p className="text-2xl font-bold text-destructive">
          {labelRefused && !order.isCancelled
            ? 'Маркетплейс не выдал ярлык'
            : 'Клиент отменил заказ'}
        </p>
        <p className="mt-1 text-lg text-muted-foreground">
          Стикер отправления не нужен. Нажмите «Закрыть заказ» — распечатается стикер
          хранения, наклейте его и оставьте вещь для кладовщика
        </p>
        {/* Связка Яндекса: у заказа один ярлык на несколько вещей, поэтому
            отмена касается всей связки. Упаковщица стикерует вещи по очереди,
            но должна знать общее число — чтобы не потерять часть. */}
        {order.groupKey && (order.groupSize || 0) > 1 && (
          <p className="mt-2 rounded-md border border-destructive/40 bg-background px-3 py-2 text-lg font-semibold">
            Это связка: всего вещей {order.groupSize}, эта —{' '}
            {order.groupPosition || 1}. Стикеруйте по очереди и держите их вместе
          </p>
        )}
      </div>
    ) : (
      <>
        {/* Отправление уже помечено как уехавшее, но ярлык на него один на всю посылку
            и обычно ещё выдаётся. Раньше мы даже не пробовали его запросить и сразу
            гнали вещь на хранение — из-за этого вещи многовещевых посылок застревали
            на терминале. Теперь печать доступна: OZON либо отдаст ярлык (вещь доедет
            к своему покупателю), либо откажет — и тогда предложим стикер хранения. */}
        {order.labelGone && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-center text-amber-900">
            <p className="text-2xl font-bold">Отправление уже помечено как уехавшее</p>
            <p className="mt-1 text-lg">
              Ярлык один на всю посылку — попробуйте распечатать. Если маркетплейс
              откажет, появится стикер хранения
            </p>
          </div>
        )}
        <Button size="lg" className="h-20 w-full text-2xl font-semibold" onClick={onPrint}>
          <Icon name="Printer" size={30} className="mr-3" />
          {order.orderType === 'FBS'
            ? 'Распечатать ярлык отправления'
            : 'Распечатать стикер'}
        </Button>
      </>
    )}

    {(printed || order.isCancelled || labelRefused) && (
      <Button
        size="lg"
        className="h-20 w-full bg-emerald-600 text-2xl font-semibold text-white hover:bg-emerald-700"
        onClick={onClose}
        disabled={closing}
      >
        <Icon
          name={closing ? 'Loader2' : 'Check'}
          size={30}
          className={`mr-3 ${closing ? 'animate-spin' : ''}`}
        />
        Закрыть заказ
      </Button>
    )}

    {/* После печати ярлыка «Отмена» гаснет: вещь уже помечена и уехала в пакет,
        бросать такой заказ нельзя — он зависнет в стикеровке без начисления
        зарплаты, а на складе вещи уже не будет. */}
    <Button
      variant="outline"
      size="lg"
      className="h-16 w-full text-xl"
      onClick={onCancel}
      disabled={cancelBlocked}
    >
      {cancelBlocked ? 'Сначала закройте заказ' : 'Отмена'}
    </Button>
  </>
);

export default KioskOrderActions;