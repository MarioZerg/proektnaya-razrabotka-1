import type { RefObject } from 'react';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import BoxItemRow from '@/components/crm/marketplaceSupplies/BoxItemRow';
import type { GroupedBoxItem } from '@/components/crm/marketplaceSupplies/useSupplyBoxCard';
import type { SupplyBox } from '@/lib/marketplaceSuppliesApi';

interface SupplyBoxContentsProps {
  box: SupplyBox;
  canEdit: boolean;
  canScan: boolean;
  isOzonFbo: boolean;
  orderNumber: string;
  setOrderNumber: (value: string) => void;
  scanning: boolean;
  inputRef: RefObject<HTMLInputElement>;
  onSubmitScan: () => void;
  groupedItems: GroupedBoxItem[];
  onRemoveItem: (itemId: number) => void;
  onSetItemCount: (boxId: number, itemIds: number[], removeCount: number) => void;
}

/**
 * Начинка короба: поле сканера и список уложенного товара.
 *
 * Поле есть только у раскрытого короба — так кладовщик не может пикнуть вещь
 * в короб, которого сейчас не видит. Список схлопывает одинаковые размеры в
 * строку с количеством: именно это сверяют с заявкой.
 */
const SupplyBoxContents = ({
  box,
  canEdit,
  canScan,
  isOzonFbo,
  orderNumber,
  setOrderNumber,
  scanning,
  inputRef,
  onSubmitScan,
  groupedItems,
  onRemoveItem,
  onSetItemCount,
}: SupplyBoxContentsProps) => (
  <>
    {canScan && (
      <div className="flex gap-2">
        {/* У FBO в короб едет вещь с ярлыком ТОВАРА (OZN…) — именно его
            читает приёмка площадки. Складской GW здесь не принимается:
            по нему вещь только находят на полке перед стикеровкой. */}
        <Input
          ref={inputRef}
          placeholder={
            isOzonFbo
              ? 'Сканируйте ярлык товара OZON (OZN…)'
              : 'Сканируйте пакет с товаром'
          }
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmitScan()}
          className="font-mono-tech"
        />
        {scanning && (
          <div className="flex h-9 w-9 items-center justify-center">
            <Icon name="Loader2" size={16} className="animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    )}

    {box.items.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        {box.closedAt && box.packedQty
          ? `Короб закрыт с ${box.packedQty} шт. — построчный состав не сохранился`
          : 'В коробе пока нет товаров'}
      </p>
    ) : (
      <div className="space-y-1.5">
        {groupedItems.map((row) => (
          <BoxItemRow
            key={row.key}
            title={row.title}
            goodsStatus={row.goodsStatus}
            itemIds={row.itemIds}
            // Состав закрытого короба менять нельзя: он заклеен, и на
            // OZON по нему уже заведено грузоместо с этикеткой.
            canEdit={canEdit && !box.closedAt}
            onRemoveCount={(ids, count) =>
              count === 1 && ids.length === 1
                ? onRemoveItem(ids[0])
                : onSetItemCount(box.id, ids, count)
            }
          />
        ))}
        {/* Снимок при закрытии больше, чем осталось строк: часть состава
            уехавшей заявки уже вычищена. Говорим прямо, сколько уехало, —
            иначе кладовщик считает по строкам и недосчитывается. */}
        {box.closedAt && box.packedQty && box.packedQty > box.items.length && (
          <p className="text-xs text-muted-foreground">
            Короб закрыт с {box.packedQty} шт. — построчный состав сохранился
            частично ({box.items.length} из {box.packedQty})
          </p>
        )}
      </div>
    )}
  </>
);

export default SupplyBoxContents;