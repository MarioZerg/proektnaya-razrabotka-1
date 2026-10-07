import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ShipmentDetail } from '@/lib/shipmentsApi';
import { formatQuantity } from '@/lib/formatQuantity';
import { moneyAmount, moneyRub } from '@/components/crm/shipments/fromSupplierShared';

interface ReturnConfirmDialogProps {
  open: boolean;
  detail: ShipmentDetail | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (payload: {
    ourLogistics: boolean;
    logisticsCost?: number;
    comment?: string;
  }) => void;
}

const itemPrice = (item: ShipmentDetail['items'][number]) =>
  item.price ?? item.rollPurchasePrice ?? null;

/**
 * Админ подтверждает возврат: списывается метраж, логистику пишем только
 * если везли сами за свой счёт.
 */
const ReturnConfirmDialog = ({
  open,
  detail,
  busy,
  onClose,
  onConfirm,
}: ReturnConfirmDialogProps) => {
  const [ourLogistics, setOurLogistics] = useState(false);
  const [logisticsCost, setLogisticsCost] = useState('');
  const [comment, setComment] = useState('');

  const items = detail?.items.filter((item) => item.rollId && !item.removedAt) || [];

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setOurLogistics(false);
      setLogisticsCost('');
      setComment('');
      onClose();
    }
  };

  const handleConfirm = () => {
    const cost = Number(String(logisticsCost).replace(',', '.'));
    onConfirm({
      ourLogistics,
      logisticsCost: ourLogistics ? cost : undefined,
      comment: comment.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Подтвердить возврат #{detail?.id}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {detail?.supplierName || 'Поставщик'}
            {detail?.originShipmentId ? ` · приёмка #${detail.originShipmentId}` : ''}
            · {items.length} рул. Цены из той приёмки. После подтверждения метраж спишется.
          </p>
          <ul className="space-y-1 text-sm">
            {items.map((item) => {
              const price = itemPrice(item);
              const currency = item.currency || item.supplierCurrency;
              return (
                <li key={item.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {item.rollBarcode} · {item.materialName}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatQuantity(item.quantity || 0)} {item.unit || ''}
                    {price != null ? ` · ${moneyAmount(price * Number(item.quantity || 0), currency)}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="space-y-1.5">
            <Label>Комментарий</Label>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder="Причина возврата, номер претензии"
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={ourLogistics}
              onCheckedChange={(v) => setOurLogistics(v === true)}
              className="mt-0.5"
            />
            <span>
              Вернули своими силами за наш счёт
              <span className="block text-xs text-muted-foreground">
                Если поставщик забрал сам или вез за свой счёт — не отмечайте
              </span>
            </span>
          </label>

          {ourLogistics && (
            <div className="space-y-1.5">
              <Label>Стоимость логистики, ₽</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={logisticsCost}
                onChange={(e) => setLogisticsCost(e.target.value)}
                placeholder="Сумма перевозки"
              />
              {Number(logisticsCost) > 0 && (
                <p className="text-xs text-muted-foreground">
                  В лист попадёт {moneyRub(Number(logisticsCost))}
                </p>
              )}
            </div>
          )}

          <Button className="w-full" onClick={handleConfirm} disabled={busy}>
            {busy ? 'Подтверждение...' : 'Подтвердить возврат'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReturnConfirmDialog;
