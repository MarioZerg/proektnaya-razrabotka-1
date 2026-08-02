import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface ReceiveReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCreate: () => void;
  shelves: Shelf[];
  orderNumber: string;
  setOrderNumber: (value: string) => void;
  shelfId: string;
  setShelfId: (value: string) => void;
  saving: boolean;
  onSave: () => void;
}

const ReceiveReturnDialog = ({
  open,
  onOpenChange,
  onOpenCreate,
  shelves,
  orderNumber,
  setOrderNumber,
  shelfId,
  setShelfId,
  saving,
  onSave,
}: ReceiveReturnDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" onClick={onOpenCreate}>
          <Icon name="PackageCheck" size={16} className="mr-2" />
          Принять новые возвраты
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Принять возврат с маркетплейса</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Связка с маркетплейсом появится позже через API — сейчас укажите номер заказа
            вручную после визуального осмотра товара.
          </p>
          <div className="space-y-1.5">
            <Label>Номер заказа</Label>
            <Input
              placeholder="Номер заказа"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              className="font-mono-tech"
            />
          </div>
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
          <Button className="w-full" onClick={onSave} disabled={saving || !orderNumber.trim()}>
            {saving ? 'Сохранение...' : 'Принять на хранение'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReceiveReturnDialog;
