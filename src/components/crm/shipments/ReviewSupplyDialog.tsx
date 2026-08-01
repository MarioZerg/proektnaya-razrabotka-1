import { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import type { Supplier } from '@/lib/suppliersApi';
import type { Material } from '@/lib/materialsApi';
import type { ShipmentDetail } from '@/lib/shipmentsApi';
import { emptyRow, type ItemRow } from '@/components/crm/shipments/fromSupplierShared';

interface ReviewSupplyDialogProps {
  reviewShipment: ShipmentDetail | null;
  onOpenChange: (open: boolean) => void;
  suppliers: Supplier[];
  materials: Material[];
  reviewSupplierId: string;
  setReviewSupplierId: (value: string) => void;
  reviewRows: ItemRow[];
  setReviewRows: Dispatch<SetStateAction<ItemRow[]>>;
  reviewSaving: boolean;
  onSaveReview: () => void;
  onApprove: () => void;
  rejectId: number | null;
  setRejectId: (id: number | null) => void;
  onReject: () => void;
}

const ReviewSupplyDialog = ({
  reviewShipment,
  onOpenChange,
  suppliers,
  materials,
  reviewSupplierId,
  setReviewSupplierId,
  reviewRows,
  setReviewRows,
  reviewSaving,
  onSaveReview,
  onApprove,
  rejectId,
  setRejectId,
  onReject,
}: ReviewSupplyDialogProps) => {
  const updateReviewRow = (idx: number, field: keyof ItemRow, value: string) =>
    setReviewRows((r) => r.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  const addReviewRow = () => setReviewRows((r) => [...r, { ...emptyRow }]);
  const removeReviewRow = (idx: number) => setReviewRows((r) => r.filter((_, i) => i !== idx));

  const materialUnit = (materialId: string) => materials.find((m) => String(m.id) === materialId)?.unit || '';

  return (
    <>
      {/* Карточка подтверждения поставки администратором */}
      <Dialog open={!!reviewShipment} onOpenChange={(open) => !open && onOpenChange(false)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Проверка поставки #{reviewShipment?.id}</DialogTitle>
          </DialogHeader>
          {reviewShipment && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Поставщик</Label>
                <Select value={reviewSupplierId} onValueChange={setReviewSupplierId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите поставщика" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Материалы</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addReviewRow}>
                    <Icon name="Plus" size={14} className="mr-1" />
                    Добавить материал
                  </Button>
                </div>
                {reviewRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_100px_100px_auto] gap-2">
                    <Select value={row.materialId} onValueChange={(v) => updateReviewRow(idx, 'materialId', v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Материал" />
                      </SelectTrigger>
                      <SelectContent>
                        {materials.map((m) => (
                          <SelectItem key={m.id} value={String(m.id)}>
                            {m.name} ({m.unit})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder={materialUnit(row.materialId) || 'метр/шт'}
                      value={row.quantity}
                      onChange={(e) => updateReviewRow(idx, 'quantity', e.target.value)}
                    />
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      placeholder="Рулонов"
                      value={row.numberRolls}
                      onChange={(e) => updateReviewRow(idx, 'numberRolls', e.target.value)}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => removeReviewRow(idx)}
                      disabled={reviewRows.length === 1}
                    >
                      <Icon name="Trash2" size={16} />
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Проверьте метраж/количество и число рулонов — при необходимости поправьте
                  перед подтверждением (штрихкоды рулонов система присвоит после подтверждения).
                </p>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={onSaveReview} disabled={reviewSaving}>
                  {reviewSaving ? 'Сохранение...' : 'Сохранить правки'}
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={() => setRejectId(reviewShipment.id)}
                  disabled={reviewSaving}
                >
                  Отклонить
                </Button>
                <Button className="flex-1" onClick={onApprove} disabled={reviewSaving}>
                  {reviewSaving ? 'Подтверждение...' : 'Подтвердить'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={rejectId !== null} onOpenChange={(open) => !open && setRejectId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отклонить поставку?</AlertDialogTitle>
            <AlertDialogDescription>
              Позиции будут удалены, материал не появится на складе. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={onReject}>Отклонить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ReviewSupplyDialog;
