import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { zoneBarClass, zoneLabels } from '@/lib/workZone';
import { shortProductName } from '@/lib/shortProductName';
import ShopBadge from '@/components/crm/ShopBadge';
import SupplyLink from '@/components/crm/goodsWarehouse/SupplyLink';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import type { Shelf } from '@/lib/shelvesApi';
import ShelfPhotoDialog from '@/components/crm/goodsWarehouse/ShelfPhotoDialog';
import { useAuth } from '@/context/AuthContext';
import { printStorageSticker } from '@/lib/printStorageSticker';
import { printIndividualSticker } from '@/lib/printIndividualSticker';
import {
  statusLabels,
  statusVariant,
  statusZone,
  canPrintStorageSticker,
} from '@/components/crm/goodsWarehouse/goodsWarehouseShared';
import { formatDateTime } from '@/lib/dateUtils';

interface GoodsWarehouseCardsProps {
  items: GoodsWarehouseItem[];
  onReturnToWorkshop: (id: number) => void;
  onMarkLost: (id: number) => void;
  /** Перепечатать ярлык маркетплейса по вещи, собранной с полки. */
  onPrintMpLabel?: (item: GoodsWarehouseItem) => void;
  /** Отбор менеджера в поставку: карточку можно отметить галочкой. */
  pickMode?: boolean;
  pickedIds?: number[];
  onTogglePick?: (id: number) => void;
  /** Лента стикеров хранения: галочка на карточке. */
  canSelectStickers?: boolean;
  selectedIds?: number[];
  onToggleSelect?: (id: number) => void;
  isAdmin?: boolean;
  onRequestDelete?: (id: number) => void;
  /** Справочник полок, уже загруженный со страницы. Снимок берём отсюда, без отдельного запроса на карточку. */
  shelves?: Shelf[];
}

/** Мобильный вид склада готового товара — карточки вместо широкой таблицы,
 * чтобы на телефоне не нужно было листать вбок. */
const GoodsWarehouseCards = ({
  items,
  onMarkLost,
  isAdmin = false,
  onRequestDelete,
  shelves = [],
}: GoodsWarehouseCardsProps) => {
  const { user } = useAuth();
  // Печать наклеек из списка — только старшему кладовщику: см. пояснение в таблице.
  // Обычный кладовщик печатает стикер тогда, когда держит вещь в руках, — на сборке.
  const canPrintStickers = user?.role === 'senior_storekeeper' || user?.role === 'admin';
  // Вещь НА ХРАНЕНИИ печатает любой кладовщик: она никуда не едет, ярлыка
  // маркетплейса на ней нет, перепутать нечего. А без наклейки (затёрлась,
  // отклеилась) вещь не отсканировать в подбор — работа встаёт.
  // 'shipped' — вещь числится уехавшей, но физически вернулась к кладовщику
  // (вынули из короба, отказ на приёмке, отмена после закрытия поставки).
  // Без наклейки её не положить на полку, поэтому печать разрешена.
  const canPrintShelfSticker = (item: GoodsWarehouseItem) =>
    canPrintStickers || item.status === 'in_stock' || item.status === 'shipped';

  // Адрес снимка по id полки. Список полок приходит один раз со страницы —
  // на каждую карточку за ним не ходим, картинку качаем только по клику.
  const photoByShelf = useMemo(() => {
    const map = new Map<number, string>();
    for (const shelf of shelves) {
      if (shelf.photoUrl) map.set(shelf.id, shelf.photoUrl);
    }
    return map;
  }, [shelves]);
  const [photo, setPhoto] = useState<{ name: string; url: string } | null>(null);

  return (
    <div className="flex flex-col gap-2">
      {items.map((i) => {
        const canAct = i.status === 'in_stock' || i.status === 'picking';
        const addedByHand = i.receiveReason === 'admin' || i.receiveReason === 'manual';
        const size = i.width && i.height ? `${i.width}×${i.height}` : '';
        const whNumber = i.orderNumber?.startsWith('WH-') ? i.orderNumber : null;
        const orderNumber = i.reservedOrderNumber || (whNumber ? null : i.orderNumber);
        const shelfPhoto =
          i.status === 'in_stock' && i.shelfId != null ? photoByShelf.get(i.shelfId) : undefined;
        return (
          <div
            key={i.id}
            className={`group relative grid min-w-0 grid-cols-1 items-center gap-x-3 gap-y-1 overflow-hidden rounded-md border border-border bg-card px-3 py-2 pl-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] ${
              addedByHand ? 'bg-amber-50/70' : ''
            }`}
          >
            <span
              className={`absolute inset-y-0 left-0 w-1 ${zoneBarClass[statusZone[i.status]]}`}
              title={zoneLabels[statusZone[i.status]]}
            />

            <div className="flex min-w-0 flex-col items-start gap-0.5">
              {addedByHand && (
                <span className="rounded-br-md bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  Вручную
                </span>
              )}
              {i.shelfName && (
                <span className="text-[11px] font-semibold leading-tight">
                  полка № {i.shelfName}
                </span>
              )}
              {shelfPhoto && (
                <button
                  type="button"
                  className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                  onClick={() =>
                    setPhoto({
                      name: i.shelfName || '',
                      url: shelfPhoto,
                    })
                  }
                >
                  Посмотреть полку
                </button>
              )}
              {i.receivedAt && (
                <span className="whitespace-nowrap text-[11px] leading-tight text-muted-foreground">
                  {formatDateTime(i.receivedAt)}
                </span>
              )}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <ShopBadge name={i.shopName} color={i.shopColor} />
                {addedByHand && i.receivedByName && (
                  <span className="text-sm">Добавил {i.receivedByName}</span>
                )}
                <SupplyLink i={i} />
              </div>
            </div>

            <div className="flex min-w-0 flex-col items-center px-2 text-center">
              <p className="break-words text-base font-extrabold leading-tight">
                {i.material || shortProductName(i)}
              </p>
              {size && <span className="text-sm font-semibold">{size}</span>}
            </div>

            <div className="flex shrink-0 flex-col items-end justify-self-end text-right leading-tight">
              <Badge variant={statusVariant[i.status]} className="mb-1">{statusLabels[i.status]}</Badge>
              {whNumber && (
                <span className="font-mono-tech text-xs font-semibold">{whNumber}</span>
              )}
              {canPrintShelfSticker(i) && canPrintStorageSticker(i) ? (
                <button
                  type="button"
                  onClick={() =>
                    i.receiveReason === 'individual'
                      ? printIndividualSticker({
                          orderNumber: i.orderNumber || '',
                          material: i.material,
                          width: i.width,
                          height: i.height,
                          storageBarcode: i.storageBarcode,
                          product: i.product,
                        })
                      : printStorageSticker({
                          storageBarcode: i.storageBarcode,
                          title: i.product,
                          orderNumber: i.orderNumber,
                        })
                  }
                  className="font-mono-tech text-sm font-bold underline-offset-2 hover:underline"
                >
                  {i.storageBarcode}
                </button>
              ) : (
                <span className="font-mono-tech text-sm font-bold">{i.storageBarcode}</span>
              )}
              {orderNumber && (
                <Link
                  to={`/crm/inventory/goods/${i.id}`}
                  className="font-mono-tech text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  {orderNumber}
                </Link>
              )}
              <div className="mt-1 flex items-center justify-end gap-0.5 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                {canAct && (
                  <button
                    type="button"
                    title="Утерян"
                    aria-label="Утерян"
                    className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => onMarkLost(i.id)}
                  >
                    <Icon name="HelpCircle" size={14} />
                  </button>
                )}
                {isAdmin && onRequestDelete && (i.status === 'in_stock' || i.status === 'awaiting_shelf') && (
                  <button
                    type="button"
                    title="Удалить со склада"
                    aria-label="Удалить со склада"
                    className="grid h-6 w-6 place-items-center rounded-md text-destructive hover:bg-muted"
                    onClick={() => onRequestDelete(i.id)}
                  >
                    <Icon name="Trash2" size={14} />
                  </button>
                )}
              </div>
            </div>

            {i.status === 'lost' && i.lostReason && (
              <p className="col-span-full text-xs text-destructive">
                {i.lostReason.includes('пошив')
                  ? `Отправлена в пошив: ${i.lostReason.replace(/^Брак, отправлен в пошив:\s*/, '')}`
                  : `Причина: ${i.lostReason}`}
                {i.lostByName ? ` · ${i.lostByName}` : ''}
              </p>
            )}
          </div>
        );
      })}
      <ShelfPhotoDialog
        shelfName={photo?.name ?? null}
        photoUrl={photo?.url ?? null}
        onClose={() => setPhoto(null)}
      />
    </div>
  );
};

export default GoodsWarehouseCards;
