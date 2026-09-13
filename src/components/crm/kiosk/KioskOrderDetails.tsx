import { Badge } from '@/components/ui/badge';
import type { KioskOrder } from '@/lib/kioskApi';
import ShopBadge from '@/components/crm/ShopBadge';

/** Строка «свойство — значение». На широком экране такие строки встают в две
 *  колонки, поэтому подпись и значение прижаты к краям своей ячейки. */
const Line = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-4 border-b border-border py-3">
    <span className="text-xl text-muted-foreground">{label}</span>
    <span className="text-right text-2xl font-semibold">{value}</span>
  </div>
);

/**
 * Карточка заказа на терминале: что за вещь, куда едет и кто над ней работал.
 *
 * По этим строкам упаковщица сверяет вещь в руках с тем, что на экране, —
 * прежде чем наклеить ярлык. Поэтому шрифт крупный, а на широком экране строки
 * идут в две колонки: раньше они вытягивались одной длинной лентой вниз и
 * нижние приходилось листать, держа вещь в руках.
 */
const KioskOrderDetails = ({ order }: { order: KioskOrder }) => (
  <div className="grid gap-x-8 md:grid-cols-2">
    <Line
      label="Заказ"
      value={<span className="font-mono-tech font-bold">{order.orderNumber}</span>}
    />
    {/* Магазин — сразу под номером. Упаковка и вложения у МЕГАТЮЛЬ и ДЮНЫ
        разные, а вещи едут по общему конвейеру вперемешку: упаковщица должна
        видеть, чей это заказ, до того как возьмёт пакет. */}
    {order.shopName && (
      <Line
        label="Магазин"
        value={
          <ShopBadge
            name={order.shopName}
            color={order.shopColor}
            className="px-2 py-1 text-base"
          />
        }
      />
    )}
    <Line label="Товар" value={order.product} />
    <Line label="Материал" value={order.material || '—'} />
    <Line
      label="Размер"
      value={order.width && order.height ? `${order.width}×${order.height}` : '—'}
    />
    <Line
      label="Маркетплейс"
      value={
        <>
          {order.marketplace || 'Индивидуальный'}
          {order.orderType && order.orderType !== 'Индивидуальный' && (
            <Badge variant="secondary" className="ml-2 text-base">
              {order.orderType}
            </Badge>
          )}
        </>
      }
    />
    {/* Кластер FBO — город, куда уедет поставка. Нужен, чтобы не смешать
        вещи из разных поставок в одну коробку. */}
    {order.orderType === 'FBO' && order.cluster && (
      <Line label="Город назначения" value={order.cluster} />
    )}
    {/* Вещь из связки: показываем, какая она по счёту в заказе покупателя. */}
    {order.groupSize && order.groupSize > 1 && (
      <Line label="Связка" value={`${order.groupPosition} из ${order.groupSize}`} />
    )}
    <Line label="Закройщик" value={order.cutterName || '—'} />
    <Line label="Швея" value={order.sewerName || order.assignedUserName || '—'} />
  </div>
);

export default KioskOrderDetails;