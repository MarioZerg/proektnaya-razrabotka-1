import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { printStorageSticker } from '@/lib/printStorageSticker';
import {
  formatDate,
  statusLabels,
  statusVariant,
  reasonLabels,
  reasonIcons,
  reasonClass,
} from '@/components/crm/goodsWarehouse/goodsWarehouseShared';

interface GoodsWarehouseCardsProps {
  items: GoodsWarehouseItem[];
  onReturnToWorkshop: (id: number) => void;
  onMarkLost: (id: number) => void;
}

/** Мобильный вид склада готового товара — карточки вместо широкой таблицы,
 * чтобы на телефоне не нужно было листать вбок. */
const GoodsWarehouseCards = ({
  items,
  onReturnToWorkshop,
  onMarkLost,
}: GoodsWarehouseCardsProps) => {
  return (
    <div className="space-y-3">
      {items.map((i) => {
        const canAct = i.status === 'in_stock' || i.status === 'picking';
        return (
          <div
            key={i.id}
            className={`rounded-md border border-border p-3 ${
              // Принятые администратором вручную подсвечены: их не было в заказах
              // маркетплейса, по ним может понадобиться отдельная сверка.
              i.receiveReason === 'admin' ? 'bg-violet-50' : ''
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">{i.product || '—'}</div>
                <div className="text-xs text-muted-foreground">
                  {i.orderNumber || 'без заказа'} · #{i.id}
                </div>
              </div>
              <Badge variant={statusVariant[i.status]}>{statusLabels[i.status]}</Badge>
            </div>

            <button
              type="button"
              onClick={() =>
                printStorageSticker({
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
              <p className="mt-2 text-xs text-destructive">Причина: {i.lostReason}</p>
            )}

            <div className="mt-2 text-xs text-muted-foreground">
              Принят {formatDate(i.receivedAt)}
              {i.shippedAt ? ` · отгружен ${formatDate(i.shippedAt)}` : ''}
            </div>

            {canAct && (
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => onReturnToWorkshop(i.id)}>
                  <Icon name="Undo2" size={14} className="mr-1.5" />В цех
                </Button>
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
