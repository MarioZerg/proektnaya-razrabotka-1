import { Dispatch, SetStateAction } from 'react';
import { Link } from 'react-router-dom';
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
import { isHiddenSystemNumber, publicOrderNumber, type EditFormState } from '@/components/crm/orders/ordersShared';

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
  const shownNumber = editingOrder ? publicOrderNumber(editingOrder) : null;
  // Заказ интернет-магазина: площадка и тип у него одни и те же, а статус
  // двигается по конвейеру во вкладке «Товары для пошива». Ручной выбор здесь
  // только сбивал бы этап: заказ «Выполнен», а вещь ещё не сшита.
  const isSiteOrder = editingOrder?.marketplace === 'IM';
  const hideSystemNumber = form ? isHiddenSystemNumber(form.orderNumber) : false;
  const productLabel = editingOrder
    ? [editingOrder.material, editingOrder.width && editingOrder.height
        ? `${editingOrder.width}×${editingOrder.height}`
        : null]
        .filter(Boolean)
        .join(' ') || editingOrder.product || '—'
    : '';

  return (
    <Dialog open={editingOrder !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isSiteOrder ? 'Заказ интернет-магазина' : 'Изменить заказ'}</DialogTitle>
        </DialogHeader>

        {form && (
          <div className="space-y-4">
            {!hideSystemNumber && !isSiteOrder && (
              <div className="space-y-1.5">
                <Label>Номер заявки</Label>
                <Input
                  value={form.orderNumber}
                  onChange={(e) => setForm((f) => f && { ...f, orderNumber: e.target.value })}
                />
              </div>
            )}
            {(hideSystemNumber || isSiteOrder) && shownNumber && (
              <p className="font-mono-tech text-sm font-semibold">{shownNumber}</p>
            )}

            <div className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">Товар</p>
              <p className="font-semibold">{productLabel}</p>
            </div>

            {isSiteOrder && (
              <div className="space-y-2 rounded-md border border-border px-3 py-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Интернет-магазин · статус: </span>
                  <b>{editingOrder?.sewingStatus || form.status}</b>
                </p>
                {editingOrder?.deliveryTrackingNumber && (
                  <p>
                    <span className="text-muted-foreground">Трек Ozon Доставки: </span>
                    <span className="font-mono-tech">{editingOrder.deliveryTrackingNumber}</span>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Статус меняется по конвейеру во вкладке{' '}
                  <Link to="/crm/marketplace/sewing-items" className="underline" onClick={onClose}>
                    «Товары для пошива»
                  </Link>
                  .
                </p>
              </div>
            )}

            {!isSiteOrder && (
            <>
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
              <Label>Статус заказа</Label>
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
            </>
            )}

            {!isSiteOrder && (
            <Button
              onClick={onSave}
              disabled={saving}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
            </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default EditOrderDialog;
