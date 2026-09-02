import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import {
  fetchStalledShipments,
  type StalledShipment,
} from '@/lib/goodsWarehouseApi';
import { formatDate } from '@/lib/dateUtils';

/**
 * Предупреждение: маркетплейс ждёт товар, а по заказу никто не работает.
 *
 * Так теряются заказы, закрытые готовой вещью со склада. Подбор помечает заказ
 * собранным, но если вещь не попала в работу кладовщику, дальше не происходит
 * ничего: цех такой заказ не видит (он закрыт складом), склад тоже (вещь числится
 * свободным остатком). Отправление молча висит в «ожидает сборки» на стороне
 * маркетплейса, пока его не заметят вручную — так три заказа провисели неделями.
 *
 * Блок висит на главной и показывает такие дыры сам. Пусто — блок не рисуется,
 * и это нормальное состояние: заказы младше суток сюда не попадают, их просто
 * ещё не успели разобрать.
 */
const StalledShipmentsCard = () => {
  const [items, setItems] = useState<StalledShipment[]>([]);

  useEffect(() => {
    fetchStalledShipments()
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <Icon name="PackageX" size={20} className="mt-0.5 shrink-0 text-red-600" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-red-900">
            Зависшие отправления: {items.length} шт
          </p>
          <p className="mt-0.5 text-sm text-red-900">
            Маркетплейс ждёт эти заказы, но по ним никто не работает: в цех они не
            попали, у кладовщика в подборе их тоже нет. Проверьте на складе.
          </p>

          <div className="mt-3 space-y-1.5">
            {items.map((i) => (
              <div
                key={i.orderId}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm text-red-900"
              >
                <span className="font-mono font-medium">{i.orderNumber}</span>
                {i.marketplace && (
                  <span className="rounded-sm bg-red-200 px-1.5 text-xs font-medium">
                    {i.marketplace}
                  </span>
                )}
                {i.product && <span className="text-xs">{i.product}</span>}
                {i.shelfName && (
                  <span className="text-xs text-red-800">полка {i.shelfName}</span>
                )}
                {i.createdAt && (
                  <span className="text-xs text-red-800">
                    с {formatDate(i.createdAt)}
                  </span>
                )}
              </div>
            ))}
          </div>

          <Link
            to="/crm/inventory/goods-picking"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-red-800 underline underline-offset-2 hover:text-red-900"
          >
            Открыть подбор на складе
            <Icon name="ArrowRight" size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
};

export default StalledShipmentsCard;
