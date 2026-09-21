import { Link } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';

interface SupplyLinkProps {
  i: GoodsWarehouseItem;
}

/**
 * Поставка, в которую вещь уже отсканирована, — ссылкой прямо из строки склада.
 *
 * Кладовщик находит вещь по стикеру и видит «На поставку». Дальше начинался
 * тупик: в какую именно отгрузку она уехала, строка не говорила, и человек шёл
 * в «Отгрузки на маркетплейс» перебирать открытые поставки одну за другой —
 * а их там по несколько на каждый магазин и схему. Особенно больно на FBS:
 * поставки живут по дню-два, их много, и номера у них похожие.
 *
 * Поэтому показываем не id из базы (#1307 никому ничего не говорит), а тот
 * номер, которым поставка подписана в кабинете маркетплейса и на коробе, —
 * и делаем его кнопкой перехода.
 *
 * Вещей без поставки на складе большинство, поэтому ничего не рисуем, когда
 * поля нет: пустая строка «Поставка: —» была бы шумом в каждой строке.
 */
const SupplyLink = ({ i }: SupplyLinkProps) => {
  if (!i.supplyId) return null;

  // Номер с маркетплейса приходит не всегда: у только что созданной FBS-поставки
  // его ещё нет. Тогда подписываем нашим номером — ссылка всё равно рабочая.
  const label = i.supplyNumber || `№${i.supplyId}`;

  return (
    <Link
      to={`/crm/shipments/to-marketplace/${i.supplyId}`}
      // Строка склада местами кликабельна сама (отбор в поставку) — гасим всплытие,
      // чтобы нажатие на ссылку не сработало заодно как выбор вещи.
      onClick={(e) => e.stopPropagation()}
      className="mt-1 inline-flex max-w-full items-center gap-1 rounded-sm bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-900 hover:bg-sky-200"
      title={`Открыть поставку ${label}`}
    >
      <Icon name="Truck" size={11} className="shrink-0" />
      <span className="truncate">
        {i.supplyType ? `${i.supplyType} ` : ''}
        {label}
      </span>
    </Link>
  );
};

export default SupplyLink;
