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
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-xl font-bold">Отгрузка от поставщика</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Приехала машина — указали материал, общий метраж/кол-во и сколько рулонов/пачек
          привезли. Поставка уходит администратору на проверку — материал появится на
          складе только после подтверждения
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
              <Label>Поставщик *</Label>
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
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Материалы</Label>
                <Button type="button" size="sm" variant="outline" onClick={addRow}>
                  <Icon name="Plus" size={14} className="mr-1" />
                  Добавить материал
                </Button>
              </div>
              {rows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_100px_100px_auto] gap-2">
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
                  <Input
                    type="number"
                    step="0.01"
                    placeholder={materialUnit(row.materialId) || 'метр/шт'}
                    value={row.quantity}
                    onChange={(e) => updateRow(idx, 'quantity', e.target.value)}
                  />
                  <Input
                    type="number"
                    step="1"
                    min="1"
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
                Например: пришло 3 пачки пакетов по 1000 шт — материал «Пакет 25х30»,
                количество 3000, рулонов 3. Штрихкоды рулонов система присвоит сама
                после подтверждения администратором.
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
