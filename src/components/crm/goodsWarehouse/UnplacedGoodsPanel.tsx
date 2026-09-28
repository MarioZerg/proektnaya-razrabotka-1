import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { unplacedReasonLabel } from '@/components/crm/goodsWarehouse/goodsWarehouseShared';

interface UnplacedGoodsPanelProps {
  items: GoodsWarehouseItem[];
  onPlace: () => void;
}

/**
 * Вещи, которые система уже считает свободным остатком, но полки у них нет.
 *
 * Их не смешивают с «забрать из цеха»: те ещё у упаковщицы. Эти уже на складе —
 * вынуты из короба, возвращены или сняты с отмены — и ждут ту же укладку сканером.
 */
const UnplacedGoodsPanel = ({ items, onPlace }: UnplacedGoodsPanelProps) => {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-bold text-amber-950">Не разложены: {items.length} шт.</p>
          <p className="text-sm text-amber-900">
            Числятся на складе, но полки нет. На стеллаж — тем же сканом, что и обычная укладка.
          </p>
        </div>
        <Button type="button" size="sm" onClick={onPlace}>
          <Icon name="ScanLine" size={16} className="mr-1.5" />
          Разложить
        </Button>
      </div>
      <div className="max-h-52 space-y-1.5 overflow-y-auto">
        {items.map((i) => (
          <div key={i.id} className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium leading-tight text-amber-950">
                {[i.material, i.width && i.height ? `${i.width}×${i.height}` : null]
                  .filter(Boolean)
                  .join(' ') || i.product || '—'}
              </p>
              <p className="text-xs text-amber-900">
                {unplacedReasonLabel(i.receiveReason)}
                {i.orderNumber ? ` · заказ ${i.orderNumber}` : ''}
              </p>
            </div>
            <span className="shrink-0 font-mono-tech text-xs text-amber-900">
              {i.storageBarcode}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default UnplacedGoodsPanel;
