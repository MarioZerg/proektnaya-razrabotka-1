import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import type { MarketplaceItem } from '@/lib/marketplaceItemsApi';
import MarketplaceItemPicker from '@/components/crm/orders/MarketplaceItemPicker';

export interface AddOrdersRow {
  key: string;
  marketplaceItemId: number | null;
  quantity: number;
}

const emptyRow = (): AddOrdersRow => ({
  key: Math.random().toString(36).slice(2),
  marketplaceItemId: null,
  quantity: 1,
});

interface AddSewingOrdersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketplaceItems: MarketplaceItem[];
  saving: boolean;
  onCreate: (rows: { marketplaceItemId: number; quantity: number }[]) => void;
}

/** Догрузка товаров на пошив в уже созданную поставку: выбираем товар из справочника и
 * указываем количество. Каждая штука станет отдельным заказом на конвейере. */
const AddSewingOrdersDialog = ({
  open,
  onOpenChange,
  marketplaceItems,
  saving,
  onCreate,
}: AddSewingOrdersDialogProps) => {
  const [rows, setRows] = useState<AddOrdersRow[]>([emptyRow()]);

  const updateRow = (key: string, patch: Partial<AddOrdersRow>) =>
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const addRow = () => setRows((r) => [...r, emptyRow()]);

  const removeRow = (key: string) =>
    setRows((r) => (r.length > 1 ? r.filter((row) => row.key !== key) : r));

  const filled = rows.filter((r) => r.marketplaceItemId && r.quantity > 0);
  const totalPieces = filled.reduce((sum, r) => sum + r.quantity, 0);

  const handleCreate = () => {
    onCreate(
      filled.map((r) => ({ marketplaceItemId: r.marketplaceItemId as number, quantity: r.quantity })),
    );
    setRows([emptyRow()]);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setRows([emptyRow()]);
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Догрузить товары на пошив</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Система сначала проверит склад: если такая вещь уже лежит готовой, она зарезервируется
          с полки, а шить будем только недостающее. Каждая штука — отдельное изделие, номера
          присваиваются автоматически.
        </p>

        <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
          {rows.map((row, idx) => (
            <div key={row.key} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Позиция #{idx + 1}</span>
                {rows.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => removeRow(row.key)}
                  >
                    <Icon name="X" size={14} />
                  </Button>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Материал и размер</Label>
                <MarketplaceItemPicker
                  items={marketplaceItems}
                  value={row.marketplaceItemId}
                  onChange={(itemId) => updateRow(row.key, { marketplaceItemId: itemId })}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Количество, шт</Label>
                <Input
                  type="number"
                  min={1}
                  value={row.quantity}
                  onChange={(e) =>
                    updateRow(row.key, { quantity: Math.max(1, Number(e.target.value) || 1) })
                  }
                  className="w-32"
                />
              </div>
            </div>
          ))}
        </div>

        <Button variant="outline" onClick={addRow} className="w-full">
          <Icon name="Plus" size={16} className="mr-1.5" />
          Добавить ещё позицию
        </Button>

        <Button onClick={handleCreate} disabled={saving || filled.length === 0} className="w-full">
          {saving ? (
            <Icon name="Loader2" size={16} className="animate-spin" />
          ) : (
            `Добавить в поставку${totalPieces > 0 ? ` (${totalPieces} шт)` : ''}`
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default AddSewingOrdersDialog;
