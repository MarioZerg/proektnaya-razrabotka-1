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
import { CURRENCIES, currencySymbols, type Supplier } from '@/lib/suppliersApi';
import type { Material } from '@/lib/materialsApi';
import type { ShipmentDetail } from '@/lib/shipmentsApi';
import {
  emptyRow,
  calcCostPerUnit,
  type ItemRow,
} from '@/components/crm/shipments/fromSupplierShared';

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
  /** Курс валюты на момент приёмки — подставляется из карточки поставщика. */
  exchangeRate: string;
  setExchangeRate: (value: string) => void;
  /** Стоимость логистики поставки, делится поровну на все метры и штуки. */
  logisticsCost: string;
  setLogisticsCost: (value: string) => void;
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
  exchangeRate,
  setExchangeRate,
  logisticsCost,
  setLogisticsCost,
}: ReviewSupplyDialogProps) => {
  const updateReviewRow = (idx: number, field: keyof ItemRow, value: string) =>
    setReviewRows((r) => r.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));

  const supplier = suppliers.find((s) => String(s.id) === reviewSupplierId);
  const supplierCurrency = supplier?.currency || 'RUB';

  // Логистика делится поровну на все метры и штуки поставки. В строке указан метраж ОДНОГО
  // рулона, поэтому общий объём — метраж × число рулонов.
  const totalUnits = reviewRows.reduce(
    (sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.numberRolls) || 0),
    0
  );
  const logisticsPerUnit =
    totalUnits > 0 ? (Number(logisticsCost.replace(',', '.')) || 0) / totalUnits : 0;

  // Подпись единиц для расчёта логистики. Если вся поставка в одних единицах (только ткань
  // в метрах или только фурнитура в штуках) — пишем их, иначе обобщённо «ед.».
  const rowUnits = Array.from(
    new Set(
      reviewRows
        .filter((r) => r.materialId && Number(r.quantity) > 0)
        .map((r) => materials.find((m) => String(m.id) === r.materialId)?.unit || '')
        .filter(Boolean)
    )
  );
  const unitsLabel = rowUnits.length === 1 ? rowUnits[0] : 'ед.';
  const rateValue = Number(exchangeRate.replace(',', '.')) || 0;

  // Предпросчёт себестоимости — что получится после подтверждения.
  const preview = reviewRows
    .filter((r) => r.materialId && Number(r.quantity) > 0)
    .map((r) => {
      const material = materials.find((m) => String(m.id) === r.materialId);
      // Цена: что ввёл администратор, иначе прайс поставщика.
      const fromPrice = supplier?.prices?.find((p) => p.materialId === Number(r.materialId));
      const price =
        r.price && r.price.trim() !== ''
          ? Number(r.price.replace(',', '.'))
          : (fromPrice?.price ?? 0);
      const currency = r.currency || fromPrice?.currency || supplierCurrency;
      return {
        name: material?.name || 'Материал',
        unit: material?.unit || '',
        cost: calcCostPerUnit(price || 0, currency, rateValue, logisticsPerUnit),
      };
    })
    .filter((p) => p.cost > 0);
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Label>Материалы</Label>
                  <Button type="button" size="sm" variant="outline" onClick={addReviewRow}>
                    <Icon name="Plus" size={14} className="mr-1" />
                    Добавить материал
                  </Button>
                </div>
                {reviewRows.map((row, idx) => (
                  <div key={idx} className="space-y-1">
                  <div className="grid grid-cols-[1fr_90px_80px_90px_90px_auto] gap-2">
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
                    {/* Метраж ОДНОГО рулона — как написано на самом рулоне. */}
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      title="Сколько в одном рулоне"
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
                    {/* Цена за единицу у этого поставщика. Пусто — подставится прайс.
                        Значок валюты в поле: иначе «1.4» читается как рубли. */}
                    <div className="relative">
                      <Input
                        inputMode="decimal"
                        placeholder="Цена"
                        className="pr-7"
                        value={row.price ?? ''}
                        onChange={(e) => updateReviewRow(idx, 'price', e.target.value)}
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        {currencySymbols[row.currency || supplierCurrency] || ''}
                      </span>
                    </div>
                    <Select
                      value={row.currency || supplierCurrency}
                      onValueChange={(v) => updateReviewRow(idx, 'currency', v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
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
                  {/* Показываем общий метраж позиции: по нему считается склад и логистика. */}
                  {Number(row.quantity) > 0 && Number(row.numberRolls) >= 1 && (
                    <p className="pl-1 text-xs text-muted-foreground">
                      {Number(row.quantity)} {materialUnit(row.materialId) || 'ед.'} ×{' '}
                      {Number(row.numberRolls)} рул. ={' '}
                      <b>
                        {(Number(row.quantity) * Number(row.numberRolls)).toLocaleString('ru-RU')}{' '}
                        {materialUnit(row.materialId) || 'ед.'}
                      </b>{' '}
                      всего
                    </p>
                  )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Метраж указывается <b>на один рулон</b> — как написано на самом рулоне:
                  100 пог.м. и 10 рулонов = 1000 пог.м. на складе. Пустая цена подставится из
                  прайса поставщика. Штрихкоды рулонов система присвоит после подтверждения.
                </p>
              </div>

              {/* Курс и логистика — из них складывается итоговая себестоимость метра. */}
              <div className="grid grid-cols-2 gap-3 rounded-md border border-border p-3">
                <div className="space-y-1.5">
                  {/* Пишем формулой: «Курс USD к рублю» не объясняет, что именно вводить. */}
                  <Label>
                    {supplierCurrency === 'RUB'
                      ? 'Курс'
                      : `Рублей за 1 ${currencySymbols[supplierCurrency] || supplierCurrency}`}
                  </Label>
                  <Input
                    inputMode="decimal"
                    placeholder="65"
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(e.target.value)}
                    disabled={supplierCurrency === 'RUB'}
                  />
                  <p className="text-xs text-muted-foreground">
                    {supplierCurrency === 'RUB'
                      ? 'Поставщик работает в рублях — курс не нужен'
                      : 'Подставлен курс поставщика, можно поправить'}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Логистика за поставку, ₽</Label>
                  <Input
                    inputMode="decimal"
                    placeholder="0"
                    value={logisticsCost}
                    onChange={(e) => setLogisticsCost(e.target.value)}
                  />
                  {/* Показываем сам расчёт: «160 ₽ на единицу» без цифр выглядит ошибкой,
                      а с делением сразу видно, из какого количества это вышло. */}
                  <p className="text-xs text-muted-foreground">
                    {totalUnits > 0 ? (
                      <>
                        {(Number(logisticsCost.replace(',', '.')) || 0).toFixed(0)} ₽ ÷{' '}
                        {totalUnits.toLocaleString('ru-RU')} {unitsLabel} ={' '}
                        <b>{logisticsPerUnit.toFixed(2)} ₽</b> на 1 {unitsLabel}
                      </>
                    ) : (
                      'Разделится поровну на все метры и штуки поставки'
                    )}
                  </p>
                </div>
              </div>

              {/* Предпросчёт: сколько будет стоить 1 метр или штука после приёмки. */}
              {preview.length > 0 && (
                <div className="rounded-md border border-border p-3">
                  <p className="text-sm font-medium">Себестоимость после подтверждения</p>
                  <div className="mt-2 space-y-1">
                    {preview.map((p) => (
                      <div key={p.name} className="flex justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-muted-foreground">{p.name}</span>
                        <span className="shrink-0 font-medium">
                          {p.cost.toFixed(2)} ₽ / {p.unit || 'ед.'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Цена × курс + {logisticsPerUnit.toFixed(2)} ₽ логистики на 1 {unitsLabel}.
                    По этой сумме считаются недостачи.
                  </p>
                </div>
              )}

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