import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import type { Shelf } from '@/lib/shelvesApi';
import type { Order } from '@/lib/ordersApi';

interface GroupReceiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCreate: () => void;
  shelves: Shelf[];
  readyOrders: Order[];
  selectedOrderIds: number[];
  onToggleOrder: (id: number) => void;
  shelfId: string;
  setShelfId: (value: string) => void;
  saving: boolean;
  onSave: () => void;
}

const GroupReceiveDialog = ({
  open,
  onOpenChange,
  onOpenCreate,
  shelves,
  readyOrders,
  selectedOrderIds,
  onToggleOrder,
  shelfId,
  setShelfId,
  saving,
  onSave,
}: GroupReceiveDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" onClick={onOpenCreate}>
          <Icon name="Layers" size={16} className="mr-2" />
          Добавить товары группой
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Принять несколько готовых заказов на одну полку</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Полка (необязательно)</Label>
            <Select value={shelfId || 'none'} onValueChange={(v) => setShelfId(v === 'none' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Без полки" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Без полки</SelectItem>
                {shelves.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Готовые заказы</Label>
            {readyOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет готовых заказов, ожидающих приёмки</p>
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {readyOrders.map((o) => (
                  <label
                    key={o.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md p-1.5 text-sm hover:bg-muted/50"
                  >
                    <Checkbox checked={selectedOrderIds.includes(o.id)} onCheckedChange={() => onToggleOrder(o.id)} />
                    <span className="font-mono-tech">{o.orderNumber}</span>
                    <span className="text-muted-foreground">
                      · {o.material} {o.width}×{o.height}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <Button className="w-full" onClick={onSave} disabled={saving || selectedOrderIds.length === 0}>
            {saving ? 'Сохранение...' : `Принять на склад (${selectedOrderIds.length})`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GroupReceiveDialog;
