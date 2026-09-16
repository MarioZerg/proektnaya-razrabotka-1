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
import type { MaterialType, Shop } from '@/lib/materialsApi';
import {
  NEW_TYPE_VALUE,
  isShopPicked,
  setShopOverlock,
  shopNeedsOverlock,
  toggleShop,
  type MaterialFormState,
} from '@/components/crm/materials/materialsSettingsShared';

interface MaterialFormDialogProps {
  dialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
  onCreateClick: () => void;
  types: MaterialType[];
  /** Магазины предприятия — по ним разводится ассортимент и обработка края. */
  shops: Shop[];
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
  shops,
  editingId,
  form,
  setForm,
  saving,
  onSave,
}: MaterialFormDialogProps) => (
  <Dialog open={dialogOpen} onOpenChange={onDialogOpenChange}>
    <DialogTrigger asChild>
      <Button className="w-full sm:w-auto" onClick={onCreateClick}>
        Добавить материал
      </Button>
    </DialogTrigger>
    {/* Окно стало выше: к полям материала добавился блок магазинов. На телефоне
        без прокрутки кнопка «Сохранить» оказывалась за краем экрана. */}
    <DialogContent className="max-h-[90vh] overflow-y-auto">
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

        {/* МАГАЗИНЫ И ОБРАБОТКА КРАЯ.
            Ассортимент у магазинов разный, и одна и та же ткань может шиться
            по-разному: где-то через оверлок (отдельный этап и отдельное
            начисление), где-то обычной прямострочкой. Поэтому обработка
            задаётся не на материал целиком, а под каждый магазин. */}
        {shops.length > 1 && (
          <div className="space-y-2">
            <div>
              <Label>Магазины</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {form.shops.length === 0
                  ? 'Не отмечен ни один — материал общий, подходит всем магазинам'
                  : 'Материал доступен только отмеченным магазинам'}
              </p>
            </div>

            <div className="space-y-2">
              {shops.map((shop) => {
                const picked = isShopPicked(form.shops, shop.id);
                return (
                  <div
                    key={shop.id}
                    className={`rounded-md border p-3 ${picked ? 'border-primary/40 bg-muted/40' : ''}`}
                  >
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <Checkbox
                        checked={picked}
                        onCheckedChange={() =>
                          setForm((f) => ({ ...f, shops: toggleShop(f.shops, shop.id) }))
                        }
                      />
                      <span className="text-sm font-medium">{shop.name}</span>
                    </label>

                    {/* Обработку края спрашиваем только у выбранного магазина:
                        у невыбранного этот вопрос не имеет смысла. */}
                    {picked && (
                      <label className="mt-2.5 flex cursor-pointer items-start gap-2.5 border-t pt-2.5">
                        <Checkbox
                          checked={shopNeedsOverlock(form.shops, shop.id)}
                          onCheckedChange={(v) =>
                            setForm((f) => ({
                              ...f,
                              shops: setShopOverlock(f.shops, shop.id, v === true),
                            }))
                          }
                          className="mt-0.5"
                        />
                        <span className="text-sm">
                          <span className="font-medium">Боковой шов на оверлоке</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            Край обмётывают на оверлоке и только потом отдают швее.
                            Без галочки — обычная прямострочка
                          </span>
                        </span>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Магазин один — разводить нечего, оставляем прежнюю общую галочку:
            выбор из одного пункта был бы лишним шумом. */}
        {shops.length <= 1 && (
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
        )}

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