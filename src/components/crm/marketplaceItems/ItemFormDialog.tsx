import { Dispatch, SetStateAction } from 'react';
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
import type { Material } from '@/lib/materialsApi';
import type { ItemFormState, MaterialRow } from '@/components/crm/marketplaceItems/marketplaceItemsShared';

interface ItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingId: number | null;
  form: ItemFormState;
  setForm: Dispatch<SetStateAction<ItemFormState>>;
  materials: Material[];
  materialRows: MaterialRow[];
  addMaterialRow: () => void;
  updateMaterialRow: (idx: number, fields: Partial<MaterialRow>) => void;
  removeMaterialRow: (idx: number) => void;
  saving: boolean;
  onOpenCreate: () => void;
  onSave: () => void;
}

const ItemFormDialog = ({
  open,
  onOpenChange,
  editingId,
  form,
  setForm,
  materials,
  materialRows,
  addMaterialRow,
  updateMaterialRow,
  removeMaterialRow,
  saving,
  onOpenCreate,
  onSave,
}: ItemFormDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button onClick={onOpenCreate} className="bg-blue-600 text-white hover:bg-blue-700">
          <Icon name="Plus" size={16} className="mr-1.5" />
          Добавить товар
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingId ? 'Изменить товар' : 'Новый товар'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Название</Label>
            <Input
              placeholder="Например: Тюль Вуаль"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Ширина</Label>
              <Input
                type="number"
                value={form.width}
                onChange={(e) => setForm((f) => ({ ...f, width: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Высота</Label>
              <Input
                type="number"
                value={form.height}
                onChange={(e) => setForm((f) => ({ ...f, height: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>SKU / Артикул</Label>
              <Input
                placeholder="Артикул"
                value={form.article}
                onChange={(e) => setForm((f) => ({ ...f, article: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Материал</Label>
              <Input
                placeholder="Например: Вуаль"
                value={form.material}
                onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>OZON</Label>
              <Input
                value={form.ozonSku}
                onChange={(e) => setForm((f) => ({ ...f, ozonSku: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>WB</Label>
              <Input
                value={form.wbSku}
                onChange={(e) => setForm((f) => ({ ...f, wbSku: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Баркод</Label>
            <Input
              placeholder="Штрихкод товара"
              value={form.barcode}
              onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label>Материалы для изделия</Label>
              <Button type="button" size="sm" variant="outline" onClick={addMaterialRow}>
                <Icon name="Plus" size={14} className="mr-1" />
                Добавить
              </Button>
            </div>
            <div className="space-y-2">
              {materialRows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_100px_32px] gap-2">
                  <Select
                    value={row.materialId}
                    onValueChange={(v) => updateMaterialRow(idx, { materialId: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Материал" />
                    </SelectTrigger>
                    <SelectContent>
                      {materials.map((m) => (
                        <SelectItem key={m.id} value={String(m.id)}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Кол-во"
                    value={row.quantity}
                    onChange={(e) => updateMaterialRow(idx, { quantity: e.target.value })}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeMaterialRow(idx)}
                  >
                    <Icon name="X" size={14} />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <Button onClick={onSave} disabled={saving} className="w-full">
            {saving ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Сохранить'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ItemFormDialog;
