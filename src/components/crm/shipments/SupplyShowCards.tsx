import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { formatQuantity } from '@/lib/formatQuantity';
import type { ShipmentDetail, ShipmentItem } from '@/lib/shipmentsApi';

/**
 * Мобильный список рулонов приёмки (карточками).
 * Логика и разметка 1:1 перенесены из SupplyShow.
 */
interface Props {
  filtered: ShipmentItem[];
  detail: ShipmentDetail;
  isAdmin: boolean;
  editItemId: number | null;
  setEditItemId: (id: number | null) => void;
  editValue: string;
  setEditValue: (v: string) => void;
  savingQty: boolean;
  onSaveQuantity: (item: ShipmentItem) => void;
  onPrintItem: (item: ShipmentItem) => void;
}

const SupplyShowCards = ({
  filtered,
  detail,
  isAdmin,
  editItemId,
  setEditItemId,
  editValue,
  setEditValue,
  savingQty,
  onSaveQuantity,
  onPrintItem,
}: Props) => (
  <div className="space-y-3 md:hidden">
    {filtered.length === 0 && (
      <p className="py-6 text-center text-sm text-muted-foreground">Ничего не найдено</p>
    )}
    {filtered.map((item) => {
      const code = item.barcode || item.reservedBarcodes?.[0];
      const editing = editItemId === item.id;
      return (
        <div
          key={item.id}
          className={`min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3 ${
            item.removedAt ? 'opacity-60' : ''
          }`}
        >
          <div className="min-w-0">
            <div className={`break-words font-medium ${item.removedAt ? 'line-through' : ''}`}>
              {item.materialName}
            </div>
            <div className="mt-0.5 break-all font-mono-tech text-xs text-muted-foreground">
              {code || '—'}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* Рулон убран администратором: позиция осталась в документе приёмки,
                но материала на складе нет. */}
            {item.removedAt && <Badge variant="destructive">Убран</Badge>}
            {!item.removedAt && item.rollStatus === 'in_storage' && (
              <Badge variant="secondary">На складе</Badge>
            )}
            {!item.removedAt && item.rollStatus === 'in_workshop' && (
              <Badge variant="default">В цехе</Badge>
            )}
            {!item.removedAt && item.rollStatus === 'completed' && (
              <Badge variant="outline">Израсходован</Badge>
            )}
            {!item.removedAt && !item.rollStatus && (
              <span className="text-xs text-muted-foreground">не принят</span>
            )}
            <span className="text-xs text-muted-foreground">
              {item.supplierName || detail.supplierName || '—'}
            </span>
          </div>
          {item.removedAt && (
            <div className="mt-1 text-xs text-destructive">
              {item.removedReason || 'Убран из работы'}
              {item.removedByName ? ` · ${item.removedByName}` : ''}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            {editing ? (
              <div className="flex min-w-0 items-center gap-1">
                <Input
                  autoFocus
                  inputMode="decimal"
                  className="h-8 w-24 text-right"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                />
                <Button
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onSaveQuantity(item)}
                  disabled={savingQty}
                >
                  <Icon name="Check" size={14} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => setEditItemId(null)}
                >
                  <Icon name="X" size={14} />
                </Button>
              </div>
            ) : isAdmin && item.canEditQuantity ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed
                           border-primary/40 px-2 py-1 font-medium
                           hover:border-primary hover:bg-primary/5"
                title="Нажмите, чтобы изменить метраж рулона"
                onClick={() => {
                  setEditItemId(item.id);
                  setEditValue(String(item.quantity ?? ''));
                }}
              >
                <Icon name="Pencil" size={12} className="text-primary" />
                {formatQuantity(item.quantity)} {item.unit}
              </button>
            ) : (
              <span className="font-medium">
                {formatQuantity(item.quantity)} {item.unit}
              </span>
            )}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {item.costPerUnit != null
                  ? `${item.costPerUnit.toFixed(2)} ₽`
                  : '—'}
              </span>
              <Button
                variant="outline"
                size="icon"
                title="Печать стикера рулона (120×75 мм)"
                onClick={() => onPrintItem(item)}
              >
                <Icon name="Barcode" size={14} />
              </Button>
            </div>
          </div>
        </div>
      );
    })}
  </div>
);

export default SupplyShowCards;