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
import type { Workshop } from '@/lib/workshopsApi';

export interface RollForm {
  barcode: string;
  materialId: string;
  initialQuantity: string;
  workshopId: string;
  shiftNumber: string;
}

interface RollCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Кнопку-открывашку показываем только тем, кому создание разрешено. */
  canCreateRoll: boolean;
  onOpenCreate: () => void;
  form: RollForm;
  setForm: React.Dispatch<React.SetStateAction<RollForm>>;
  materials: Material[];
  workshops: Workshop[];
  selectedWorkshop: Workshop | undefined;
  saving: boolean;
  onSave: () => void;
}

/** Диалог ручного создания рулона — заголовочная часть страницы «Рулоны». */
const RollCreateDialog = ({
  open,
  onOpenChange,
  canCreateRoll,
  onOpenCreate,
  form,
  setForm,
  materials,
  workshops,
  selectedWorkshop,
  saving,
  onSave,
}: RollCreateDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    {canCreateRoll && (
      <DialogTrigger asChild>
        <Button onClick={onOpenCreate}>
          <Icon name="Plus" size={16} className="mr-2" />
          Добавить рулон
        </Button>
      </DialogTrigger>
    )}
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Новый рулон</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Штрихкод</Label>
          <Input
            value={form.barcode}
            onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
            placeholder="Например: 1-004824"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Материал</Label>
          <Select
            value={form.materialId}
            onValueChange={(v) => setForm((f) => ({ ...f, materialId: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Выберите материал" />
            </SelectTrigger>
            <SelectContent>
              {materials.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.name} ({m.unit})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Начальное количество</Label>
          <Input
            type="number"
            step="0.01"
            value={form.initialQuantity}
            onChange={(e) => setForm((f) => ({ ...f, initialQuantity: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Цех (необязательно)</Label>
          <Select
            value={form.workshopId || 'none'}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, workshopId: v === 'none' ? '' : v, shiftNumber: '' }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Склад" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Склад (без цеха)</SelectItem>
              {workshops.map((w) => (
                <SelectItem key={w.id} value={String(w.id)}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {form.workshopId && (
          <div className="space-y-1.5">
            <Label>Смена</Label>
            <Select
              value={form.shiftNumber}
              onValueChange={(v) => setForm((f) => ({ ...f, shiftNumber: v }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите смену" />
              </SelectTrigger>
              <SelectContent>
                {(selectedWorkshop?.shiftNames || []).map((name, idx) => (
                  <SelectItem key={idx + 1} value={String(idx + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Рулон в цехе обязательно должен принадлежать смене
            </p>
          </div>
        )}
        <Button className="w-full" onClick={onSave} disabled={saving}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
);

export default RollCreateDialog;
