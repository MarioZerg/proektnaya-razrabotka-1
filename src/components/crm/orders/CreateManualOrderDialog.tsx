import { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import type { MarketplaceItem } from '@/lib/marketplaceItemsApi';
import { emptyManualRow, type ManualOrderRow } from '@/components/crm/orders/ordersShared';
import MarketplaceItemPicker from '@/components/crm/orders/MarketplaceItemPicker';

interface CreateManualOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: ManualOrderRow[];
  setRows: Dispatch<SetStateAction<ManualOrderRow[]>>;
  marketplaceItems: MarketplaceItem[];
  manualSaving: boolean;
  onCreate: () => void;
}

const CreateManualOrderDialog = ({
  open,
  onOpenChange,
  rows,
  setRows,
  marketplaceItems,
  manualSaving,
  onCreate,
}: CreateManualOrderDialogProps) => {
  const updateRow = (key: string, patch: Partial<ManualOrderRow>) =>
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const addRow = () => setRows((r) => [...r, emptyManualRow()]);

  const removeRow = (key: string) => setRows((r) => (r.length > 1 ? r.filter((row) => row.key !== key) : r));

  const canCreate =
    !manualSaving && rows.length > 0 && rows.every((r) => r.marketplaceItemId);

  // Сколько изделий получится всего по всем позициям — это и создастся.
  const totalItems = rows.reduce((sum, r) => sum + (r.quantity || 1), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Индивидуальный заказ</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Пошив не под маркетплейс. Выберите размер и количество — номера заявок
          присвоятся автоматически, заказы сразу уйдут на конвейер. Кнопка ниже добавляет
          ещё одну позицию с другим размером.
        </p>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {rows.map((row, idx) => (
            <div key={row.key} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
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
                <Label>Количество, шт.</Label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    onClick={() =>
                      updateRow(row.key, { quantity: Math.max(1, (row.quantity || 1) - 1) })
                    }
                    disabled={(row.quantity || 1) <= 1}
                  >
                    <Icon name="Minus" size={16} />
                  </Button>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={row.quantity}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      updateRow(row.key, {
                        quantity: Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : 1,
                      });
                    }}
                    className="h-10 text-center font-mono-tech text-base"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    onClick={() =>
                      updateRow(row.key, { quantity: Math.min(200, (row.quantity || 1) + 1) })
                    }
                    disabled={(row.quantity || 1) >= 200}
                  >
                    <Icon name="Plus" size={16} />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Система создаст {row.quantity || 1}{' '}
                  {(row.quantity || 1) === 1 ? 'заявку' : 'отдельных заявок'} — каждая пойдёт
                  по конвейеру сама
                </p>
              </div>
            </div>
          ))}
        </div>

        <Button variant="outline" onClick={addRow} className="w-full">
          <Icon name="Plus" size={16} className="mr-1.5" />
          Добавить другой размер
        </Button>

        <Button
          onClick={onCreate}
          disabled={!canCreate}
          className="w-full bg-blue-600 text-white hover:bg-blue-700"
        >
          {manualSaving ? (
            <Icon name="Loader2" size={16} className="animate-spin" />
          ) : (
            `Создать ${totalItems} ${totalItems === 1 ? 'заказ' : 'заказов'}`
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default CreateManualOrderDialog;