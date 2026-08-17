import { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import type { Supplier } from '@/lib/suppliersApi';
import type { Material } from '@/lib/materialsApi';
import { emptyRow, type ItemRow } from '@/components/crm/shipments/fromSupplierShared';

interface CreateSupplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCreate: () => void;
  suppliers: Supplier[];
  materials: Material[];
  supplierId: string;
  setSupplierId: (value: string) => void;
  comment: string;
  setComment: (value: string) => void;
  rows: ItemRow[];
  setRows: Dispatch<SetStateAction<ItemRow[]>>;
  saving: boolean;
  onSave: () => void;
}

const CreateSupplyDialog = ({
  open,
  onOpenChange,
  onOpenCreate,
  suppliers,
  materials,
  supplierId,
  setSupplierId,
  comment,
  setComment,
  rows,
  setRows,
  saving,
  onSave,
}: CreateSupplyDialogProps) => {
  const addRow = () => setRows((r) => [...r, { ...emptyRow }]);
  const removeRow = (idx: number) => setRows((r) => r.filter((_, i) => i !== idx));
  const updateRow = (idx: number, field: keyof ItemRow, value: string) =>
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));

  const materialUnit = (materialId: string) => materials.find((m) => String(m.id) === materialId)?.unit || '';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold">Отгрузка от поставщика</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Приехала машина — указали материал, метраж и сколько рулонов привезли. Штрихкоды
          выдаются сразу: стикеры можно печатать и клеить при разгрузке. Материал появится
          на складе после проверки администратором
        </p>
      </div>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogTrigger asChild>
          <Button onClick={onOpenCreate}>
            <Icon name="Plus" size={16} className="mr-2" />
            Новая приёмка
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Приёмка от поставщика</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Основной поставщик *</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
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
              <p className="text-xs text-muted-foreground">
                Если машина привезла материал от нескольких поставщиков — укажите своего
                у каждой строки ниже. Стоимость поездки разделится между ними
                пропорционально привезённому объёму.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label>Материалы</Label>
                <Button type="button" size="sm" variant="outline" onClick={addRow}>
                  <Icon name="Plus" size={14} className="mr-1" />
                  Добавить материал
                </Button>
              </div>
              {rows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_140px_100px_100px_auto] gap-2">
                  <Select value={row.materialId} onValueChange={(v) => updateRow(idx, 'materialId', v)}>
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
                  {/* Поставщик строки. Пусто — берётся основной поставщик приёмки. */}
                  <Select
                    value={row.supplierId || '__main'}
                    onValueChange={(v) => updateRow(idx, 'supplierId', v === '__main' ? '' : v)}
                  >
                    <SelectTrigger title="От кого приехал этот материал">
                      <SelectValue placeholder="Поставщик" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__main">Основной</SelectItem>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          {s.name}
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
                    onChange={(e) => updateRow(idx, 'quantity', e.target.value)}
                  />
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    title="Сколько таких рулонов пришло"
                    placeholder="Рулонов"
                    value={row.numberRolls}
                    onChange={(e) => updateRow(idx, 'numberRolls', e.target.value)}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeRow(idx)}
                    disabled={rows.length === 1}
                  >
                    <Icon name="Trash2" size={16} />
                  </Button>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Количество указывается <b>на один рулон или пачку</b>. Пришло 10 рулонов по
                100 пог.м. — пишем 100 и 10 рулонов. Пришло 3 пачки пакетов по 1000 шт —
                пишем 1000 и 3. Штрихкоды система присвоит сразу — их можно распечатать и
                наклеить на рулоны, не дожидаясь администратора.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
            </div>

            <Button className="w-full" onClick={onSave} disabled={saving}>
              {saving ? 'Отправка...' : 'Отправить на подтверждение'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CreateSupplyDialog;