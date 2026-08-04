import { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import type { Marketplace, OrderType } from '@/lib/ordersApi';
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Добавить заказы вручную</DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">
          Каждая строка — отдельный уникальный заказ (1 заказ = 1 заявка). Номер заказа
          присваивается автоматически. Нажмите «+», чтобы добавить ещё один заказ в этом же окне.
        </p>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {rows.map((row, idx) => (
            <div key={row.key} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Заказ #{idx + 1}</span>
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Маркетплейс</Label>
                  <Select
                    value={row.marketplace}
                    onValueChange={(v) => updateRow(row.key, { marketplace: v as Marketplace })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OZON">OZON</SelectItem>
                      <SelectItem value="WB">Wildberries</SelectItem>
                      <SelectItem value="Yandex">Яндекс.Маркет</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Тип</Label>
                  <Select
                    value={row.orderType}
                    onValueChange={(v) => updateRow(row.key, { orderType: v as OrderType })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FBO">FBO</SelectItem>
                      <SelectItem value="FBS">FBS</SelectItem>
                      <SelectItem value="Индивидуальный">Индивидуальный</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Материал и размер</Label>
                <MarketplaceItemPicker
                  items={marketplaceItems}
                  value={row.marketplaceItemId}
                  onChange={(itemId) => updateRow(row.key, { marketplaceItemId: itemId })}
                />
              </div>
            </div>
          ))}
        </div>

        <Button variant="outline" onClick={addRow} className="w-full">
          <Icon name="Plus" size={16} className="mr-1.5" />
          Добавить ещё заказ
        </Button>

        <Button
          onClick={onCreate}
          disabled={!canCreate}
          className="w-full bg-blue-600 text-white hover:bg-blue-700"
        >
          {manualSaving ? (
            <Icon name="Loader2" size={16} className="animate-spin" />
          ) : (
            `Создать ${rows.length > 1 ? `заказы (${rows.length})` : 'заказ'}`
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default CreateManualOrderDialog;