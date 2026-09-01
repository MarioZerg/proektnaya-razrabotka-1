import type { Dispatch, SetStateAction } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import Icon from '@/components/ui/icon';
import type { MaterialType } from '@/lib/materialsApi';
import {
  NEW_TYPE_VALUE,
  type MaterialFormState,
} from '@/components/crm/materials/materialsSettingsShared';

interface MaterialFormDialogProps {
  dialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
  onCreateClick: () => void;
  types: MaterialType[];
  editingId: number | null;
  form: MaterialFormState;
  setForm: Dispatch<SetStateAction<MaterialFormState>>;
  saving: boolean;
  onSave: () => void;
}

/** Окно создания и редактирования материала: тип, название, единица, статус, оверлок. */
const MaterialFormDialog = ({
  dialogOpen,
  onDialogOpenChange,
  onCreateClick,
  types,
  editingId,
  form,
  setForm,
  saving,
  onSave,
}: MaterialFormDialogProps) => (
  <Dialog open={dialogOpen} onOpenChange={onDialogOpenChange}>
    <DialogTrigger asChild>
      <Button onClick={onCreateClick}>Добавить материал</Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{editingId ? 'Изменить материал' : 'Новый материал'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Тип</Label>
          <Select
            value={form.typeId}
            onValueChange={(v) => setForm((f) => ({ ...f, typeId: v }))}
          >
            <SelectTrigger>
              <SelectValue placeholder="Выберите тип" />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.name}
                </SelectItem>
              ))}
              <SelectItem value={NEW_TYPE_VALUE}>+ Создать новый тип</SelectItem>
            </SelectContent>
          </Select>
          {form.typeId === NEW_TYPE_VALUE && (
            <Input
              className="mt-2"
              placeholder="Название нового типа"
              value={form.newTypeName}
              onChange={(e) => setForm((f) => ({ ...f, newTypeName: e.target.value }))}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Название</Label>
          <Input
            placeholder="Например: Вуаль"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>

        {/* Себестоимость здесь больше не задаётся: цену материала определяет прайс
            поставщика, а точная себестоимость считается при приёмке (цена × курс +
            логистика) и хранится на каждом рулоне отдельно. */}
        <div className="space-y-1.5">
          <Label>Ед. измерения</Label>
          <Input
            placeholder="п.м. / шт"
            value={form.unit}
            onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Статус</Label>
          <Select
            value={form.status}
            onValueChange={(v) => setForm((f) => ({ ...f, status: v as 'active' | 'archive' }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Активен</SelectItem>
              <SelectItem value="archive">Архив</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Ткань с осыпающимся краем. Заказы из неё идут в цехе длиннее:
            сначала оверлок, потом прямострочка. Признак ставится здесь
            один раз — дальше система сама метит все новые заказы. */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-3">
          <Checkbox
            checked={form.requiresOverlock}
            onCheckedChange={(v) =>
              setForm((f) => ({ ...f, requiresOverlock: v === true }))
            }
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="font-medium">Требует обработки на оверлоке</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Край осыпается: заказ сначала обмётывают на оверлоке и только потом
              отдают швее на прямострочку
            </span>
          </span>
        </label>

        <Button onClick={onSave} disabled={saving} className="w-full">
          {saving ? (
            <Icon name="Loader2" size={16} className="animate-spin" />
          ) : editingId ? (
            'Сохранить'
          ) : (
            'Создать'
          )}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
);

export default MaterialFormDialog;
