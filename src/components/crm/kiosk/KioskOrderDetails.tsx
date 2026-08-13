import { Badge } from '@/components/ui/badge';
import type { KioskOrder } from '@/lib/kioskApi';

/**
 * Карточка заказа на терминале: что за вещь, куда едет и кто над ней работал.
 *
 * По этим строкам упаковщица сверяет вещь в руках с тем, что на экране, —
 * прежде чем наклеить ярлык.
 */
const KioskOrderDetails = ({ order }: { order: KioskOrder }) => (
  <div className="space-y-2 text-lg">
    <div className="flex items-center justify-between border-b border-border pb-2">
      <span className="text-muted-foreground">Заказ</span>
      <span className="font-mono-tech font-bold">{order.orderNumber}</span>
    </div>
    <div className="flex items-center justify-between border-b border-border pb-2">
      <span className="text-muted-foreground">Товар</span>
      <span className="font-semibold">{order.product}</span>
    </div>
    <div className="flex items-center justify-between border-b border-border pb-2">
      <span className="text-muted-foreground">Материал</span>
      <span className="font-semibold">{order.material || '—'}</span>
    </div>
    <div className="flex items-center justify-between border-b border-border pb-2">
      <span className="text-muted-foreground">Размер</span>
      <span className="font-semibold">
        {order.width && order.height ? `${order.width}×${order.height}` : '—'}
      </span>
    </div>
    <div className="flex items-center justify-between border-b border-border pb-2">
      <span className="text-muted-foreground">Маркетплейс</span>
      <span className="font-semibold">
        {order.marketplace || 'Индивидуальный'}
        {order.orderType && order.orderType !== 'Индивидуальный' && (
          <Badge variant="secondary" className="ml-2">
            {order.orderType}
          </Badge>
        )}
      </span>
    </div>
    {/* Кластер FBO — город, куда уедет поставка. Нужен, чтобы не смешать
        вещи из разных поставок в одну коробку. */}
    {order.orderType === 'FBO' && order.cluster && (
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="text-muted-foreground">Город назначения</span>
        <span className="font-semibold">{order.cluster}</span>
      </div>
    )}
    {/* Вещь из связки: показываем, какая она по счёту в заказе покупателя. */}
    {order.groupSize && order.groupSize > 1 && (
      <div className="flex items-center justify-between border-b border-border pb-2">
        <span className="text-muted-foreground">Связка</span>
        <span className="font-semibold">
          {order.groupPosition} из {order.groupSize}
        </span>
      </div>
    )}
    <div className="flex items-center justify-between border-b border-border pb-2">
      <span className="text-muted-foreground">Закройщик</span>
      <span className="font-semibold">{order.cutterName || '—'}</span>
    </div>
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">Швея</span>
      <span className="font-semibold">
        {order.sewerName || order.assignedUserName || '—'}
      </span>
    </div>
  </div>
);

export default KioskOrderDetails;
