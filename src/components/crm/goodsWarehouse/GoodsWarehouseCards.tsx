import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { zoneBarClass, zoneLabels } from '@/lib/workZone';
import { shortProductName } from '@/lib/shortProductName';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { useAuth } from '@/context/AuthContext';
import { getAccessZone } from '@/lib/roles';
import { printStorageSticker } from '@/lib/printStorageSticker';
import { printIndividualSticker } from '@/lib/printIndividualSticker';
import {
  formatDate,
  statusLabels,
  statusVariant,
  statusZone,
  reasonLabels,
  reasonIcons,
  reasonClass,
  canPrintMarketplaceLabel,
  canPrintStorageSticker,
} from '@/components/crm/goodsWarehouse/goodsWarehouseShared';

interface GoodsWarehouseCardsProps {
  items: GoodsWarehouseItem[];
  onReturnToWorkshop: (id: number) => void;
  onMarkLost: (id: number) => void;
  /** Перепечатать ярлык маркетплейса по вещи, собранной с полки. */
  onPrintMpLabel?: (item: GoodsWarehouseItem) => void;
}

/** Мобильный вид склада готового товара — карточки вместо широкой таблицы,
 * чтобы на телефоне не нужно было листать вбок. */
const GoodsWarehouseCards = ({
  items,
  onReturnToWorkshop,
  onMarkLost,
  onPrintMpLabel,
}: GoodsWarehouseCardsProps) => {
  const { user } = useAuth();
  // Печать наклеек из списка — только старшему кладовщику: см. пояснение в таблице.
  // Обычный кладовщик печатает стикер тогда, когда держит вещь в руках, — на сборке.
  const canPrintStickers = user?.role === 'senior_storekeeper' || user?.role === 'admin';
  // Ярлык отправления — любому кладовщику: это перепечатка того же кода, когда
  // порвался пакет и вещь перекладывают в новый.
  const canPrintMpLabels = getAccessZone(user?.role) === 'warehouse' || user?.role === 'admin';

  return (
    <div className="space-y-3">
      {items.map((i) => {
        const canAct = i.status === 'in_stock' || i.status === 'picking';
        return (
          <div
            key={i.id}
            className={`relative overflow-hidden rounded-md border border-border p-3 pl-4 ${
              // Принятые администратором вручную подсвечены: их не было в заказах
              // маркетплейса, по ним может понадобиться отдельная сверка.
              i.receiveReason === 'admin' ? 'bg-amber-50' : ''
            }`}
          >
            {/* Полоса слева = чья это работа: фиолетовая — цех, зелёная — склад,
                двухцветная — вещь передают из рук в руки. Видно на бегу, не читая. */}
            <span
              className={`absolute inset-y-0 left-0 w-1.5 ${zoneBarClass[statusZone[i.status]]}`}
              title={zoneLabels[statusZone[i.status]]}
            />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold" title={i.product || ''}>
                  {shortProductName(i)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {i.orderNumber || 'без заказа'} · #{i.id}
                </div>
              </div>
              <Badge variant={statusVariant[i.status]}>{statusLabels[i.status]}</Badge>
            </div>

            {canPrintStickers && canPrintStorageSticker(i) ? (
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
                className="mt-2 flex items-center gap-1.5 font-mono-tech text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                <Icon name="Barcode" size={12} />
                {i.storageBarcode}
              </button>
            ) : (
              /* Обычному кладовщику показываем только номер: по нему он находит вещь
                 на полке, а печать делает на сборке, держа вещь в руках. */
              <div className="mt-2 flex items-center gap-1.5 font-mono-tech text-xs text-muted-foreground">
                <Icon name="Barcode" size={12} />
                {i.storageBarcode}
              </div>
            )}

            {/* ПЕРЕпечатка ярлыка для вещи, закреплённой за отправлением: порвался
                пакет — кладовщик печатает тот же ярлык прямо с телефона у стеллажа. */}
            {canPrintMpLabels && canPrintMarketplaceLabel(i) && (
              <button
                type="button"
                onClick={() => onPrintMpLabel?.(i)}
                className="mt-1.5 flex items-center gap-1.5 text-xs text-primary underline-offset-2 hover:underline"
              >
                <Icon name="Printer" size={12} />
                Ярлык {(i.marketplace || '').toUpperCase() || 'маркетплейса'}
              </button>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className={`${reasonClass[i.receiveReason] || ''} gap-1 font-normal`}
              >
                <Icon name={reasonIcons[i.receiveReason] || 'Hand'} size={12} />
                {reasonLabels[i.receiveReason] || 'Принят вручную'}
              </Badge>
              {i.shelfName && (
                <Badge variant="outline" className="gap-1 font-normal">
                  <Icon name="LayoutGrid" size={12} />
                  {i.shelfName}
                </Badge>
              )}
            </div>

            {i.status === 'lost' && i.lostReason && (
              <p className="mt-2 text-xs text-destructive">
                {i.lostReason.includes('пошив')
                  ? `Отправлена в пошив: ${i.lostReason.replace(/^Брак, отправлен в пошив:\s*/, '')}`
                  : `Причина: ${i.lostReason}`}
                {i.lostByName ? ` · ${i.lostByName}` : ''}
              </p>
            )}

            <div className="mt-2 text-xs text-muted-foreground">
              Принят {formatDate(i.receivedAt)}
              {i.shippedAt ? ` · отгружен ${formatDate(i.shippedAt)}` : ''}
            </div>

            {canAct && (
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {/* «В цех» — это возврат на ПЕРЕДЕЛКУ: вещь с браком уходит обратно
                    в пошив. Для отменённого заказа кнопку убираем: она сбрасывала
                    заказ в работу, и цех начинал шить для покупателя, который уже
                    отказался. Такую вещь оставляют на полке — она уйдёт следующему
                    заказу с теми же размерами. */}
                {!i.orderCancelled && (
                  <Button variant="outline" size="sm" onClick={() => onReturnToWorkshop(i.id)}>
                    <Icon name="Undo2" size={14} className="mr-1.5" />В цех
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => onMarkLost(i.id)}>
                  <Icon name="HelpCircle" size={14} className="mr-1.5" />
                  Утерян
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default GoodsWarehouseCards;