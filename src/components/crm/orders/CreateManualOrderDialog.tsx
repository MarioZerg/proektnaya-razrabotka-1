import { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { productOptions, type EditFormState } from '@/components/crm/orders/ordersShared';

interface CreateManualOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  manualForm: EditFormState;
  setManualForm: Dispatch<SetStateAction<EditFormState>>;
  manualSaving: boolean;
  onCreate: () => void;
}

const CreateManualOrderDialog = ({
  open,
  onOpenChange,
  manualForm,
  setManualForm,
  manualSaving,
  onCreate,
}: CreateManualOrderDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Добавить заказ вручную</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Номер заявки</Label>
            <Input
              placeholder="Например: 119956630-181"
              value={manualForm.orderNumber}
              onChange={(e) => setManualForm((f) => ({ ...f, orderNumber: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Если такой номер уже есть в системе — заказ не будет создан повторно.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Маркетплейс</Label>
              <Select
                value={manualForm.marketplace}
                onValueChange={(v) => setManualForm((f) => ({ ...f, marketplace: v as Marketplace }))}
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
                value={manualForm.orderType}
                onValueChange={(v) => setManualForm((f) => ({ ...f, orderType: v as OrderType }))}
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
            <Label>Товар</Label>
            <Select
              value={manualForm.product}
              onValueChange={(v) => setManualForm((f) => ({ ...f, product: v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {productOptions.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Один заказ — всегда 1 шт. Для нескольких единиц создайте отдельные заказы с разными номерами.
            </p>
          </div>

          <Button
            onClick={onCreate}
            disabled={manualSaving || !manualForm.orderNumber.trim()}
            className="w-full bg-blue-600 text-white hover:bg-blue-700"
          >
            {manualSaving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Создать заказ'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateManualOrderDialog;
