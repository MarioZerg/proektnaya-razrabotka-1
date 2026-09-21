import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { GoodsCard as GoodsCardType } from '@/lib/goodsWarehouseApi';
import { reasonLabels } from '@/components/crm/goodsWarehouse/goodsWarehouseShared';
import { formatDate } from './formatDate';
import { Row } from './goodsCardShared';

/** Что это за вещь и ключевые даты по ней. */
const GoodsCardDetails = ({ card }: { card: GoodsCardType }) => (
  <div className="grid gap-6 md:grid-cols-2">
    <Card className="shadow-none">
      <CardContent className="pt-6">
        <h2 className="mb-2 font-semibold">О товаре</h2>
        <Row label="Ткань" value={card.material || '—'} />
        <Row
          label="Размер"
          value={card.width && card.height ? `${card.width}×${card.height}` : '—'}
        />
        <Row label="Полка" value={card.shelfName || '—'} />
        <Row
          label="Откуда на складе"
          value={reasonLabels[card.receiveReason as keyof typeof reasonLabels] || '—'}
        />
        <Row label="Заказ пошива" value={card.sourceOrderNumber || '—'} />
        <Row label="Подобран под заказ" value={card.reservedOrderNumber || '—'} />
        {/* В какую отгрузку вещь отсканирована — сразу ссылкой. Раньше карточка
            знала номер поставки, но не показывала: кладовщик видел «на поставке»
            и шёл перебирать открытые отгрузки в поисках нужной. */}
        {card.supplyId && (
          <Row
            label="Поставка"
            value={
              <Link
                to={`/crm/shipments/to-marketplace/${card.supplyId}`}
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                <Icon name="Truck" size={13} className="shrink-0" />
                {card.supplyType ? `${card.supplyType} ` : ''}
                {card.supplyNumber || `№${card.supplyId}`}
              </Link>
            }
          />
        )}
        {card.lostReason && <Row label="Причина утери" value={card.lostReason} />}
      </CardContent>
    </Card>

    <Card className="shadow-none">
      <CardContent className="pt-6">
        <h2 className="mb-2 font-semibold">Даты</h2>
        <Row label="Принят на склад" value={formatDate(card.receivedAt)} />
        <Row label="Подобран под заказ" value={formatDate(card.matchedAt)} />
        <Row label="Наклеен стикер" value={formatDate(card.shippingLabeledAt)} />
        <Row label="Отгружен" value={formatDate(card.shippedAt)} />
      </CardContent>
    </Card>
  </div>
);

export default GoodsCardDetails;