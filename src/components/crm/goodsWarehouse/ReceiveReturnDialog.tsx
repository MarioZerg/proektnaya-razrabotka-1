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
import Icon from '@/components/ui/icon';

interface ReceiveReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCreate: () => void;
  orderNumber: string;
  setOrderNumber: (value: string) => void;
  saving: boolean;
  onSave: () => void;
}

const ReceiveReturnDialog = ({
  open,
  onOpenChange,
  onOpenCreate,
  orderNumber,
  setOrderNumber,
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
            вручную после визуального осмотра товара. Полка выбирается не здесь: товар встанет
            в очередь «Ждёт полку», положите его на полку сканированием стикера хранения.
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
          <Button className="w-full" onClick={onSave} disabled={saving || !orderNumber.trim()}>
            {saving ? 'Сохранение...' : 'Принять на хранение'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReceiveReturnDialog;
