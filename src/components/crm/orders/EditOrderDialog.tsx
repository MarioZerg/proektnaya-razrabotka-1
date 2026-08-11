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
import type { Marketplace, Order, OrderStatus, OrderType } from '@/lib/ordersApi';
import { productOptions, type EditFormState } from '@/components/crm/orders/ordersShared';

interface EditOrderDialogProps {
  editingOrder: Order | null;
  form: EditFormState | null;
  setForm: Dispatch<SetStateAction<EditFormState | null>>;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}

const EditOrderDialog = ({
  editingOrder,
  form,
  setForm,
  saving,
  onClose,
  onSave,
}: EditOrderDialogProps) => {
  return (
    <Dialog open={editingOrder !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Изменить заказ</DialogTitle>
        </DialogHeader>

        {form && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Номер заявки</Label>
              <Input
                value={form.orderNumber}
                onChange={(e) => setForm((f) => f && { ...f, orderNumber: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Маркетплейс</Label>
                <Select
                  value={form.marketplace}
                  onValueChange={(v) => setForm((f) => f && { ...f, marketplace: v as Marketplace })}
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
                  value={form.orderType}
                  onValueChange={(v) => setForm((f) => f && { ...f, orderType: v as OrderType })}
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
              <Label>Статус</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => f && { ...f, status: v as OrderStatus })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Новый">Новый</SelectItem>
                  <SelectItem value="В работе">В работе</SelectItem>
                  <SelectItem value="Выполнен">Выполнен</SelectItem>
                  {/* Ставится автоматически при закрытии поставки, но нужен и в списке:
                      иначе у отгруженного заказа поле статуса выглядело бы пустым. */}
                  <SelectItem value="Отгружен">Отгружен</SelectItem>
                  <SelectItem value="Отменён">Отменён</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Товар</Label>
              <Select
                value={form.product}
                onValueChange={(v) => setForm((f) => f && { ...f, product: v })}
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
                Один заказ — всегда 1 шт. Для нескольких единиц создайте отдельные заказы.
              </p>
            </div>

            <Button
              onClick={onSave}
              disabled={saving}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default EditOrderDialog;