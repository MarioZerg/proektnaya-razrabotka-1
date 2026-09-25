import { Button } from '@/components/ui/button';
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
import type { Material } from '@/lib/materialsApi';
import type { Workshop } from '@/lib/workshopsApi';

interface RequestMaterialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCreate: () => void;
  materials: Material[];
  reqMaterialId: string;
  setReqMaterialId: (value: string) => void;
  reqComment: string;
  setReqComment: (value: string) => void;
  creating: boolean;
  onCreate: () => void;
  /**
   * Админский режим: цех и смену берём не из профиля (у админа их нет), а из
   * выпадающих списков — он оформляет заявку за конкретную смену конкретного цеха.
   */
  isAdmin?: boolean;
  workshops?: Workshop[];
  reqWorkshopId?: string;
  setReqWorkshopId?: (value: string) => void;
  reqShiftNumber?: string;
  setReqShiftNumber?: (value: string) => void;
}

// Заявку на материал в цех создаёт сотрудник цеха (швея/закройщик/упаковщик) — цех и смена
// берутся из его профиля автоматически. Кладовщик заявки не создаёт (он только собирает и
// отправляет то, что уже запросили). Администратор может оформить заявку за цех: тогда он
// сам выбирает цех и смену, а заявка подписывается его именем с пометкой «Заявка от админа».
const RequestMaterialDialog = ({
  open,
  onOpenChange,
  onOpenCreate,
  materials,
  reqMaterialId,
  setReqMaterialId,
  reqComment,
  setReqComment,
  creating,
  onCreate,
  isAdmin = false,
  workshops = [],
  reqWorkshopId = '',
  setReqWorkshopId,
  reqShiftNumber = '',
  setReqShiftNumber,
}: RequestMaterialDialogProps) => {
  const selectedWorkshop = workshops.find((w) => String(w.id) === reqWorkshopId);
  const shiftOptions = Array.from(
    { length: selectedWorkshop?.shiftsCount || 0 },
    (_, i) => i + 1
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button onClick={onOpenCreate} className="w-full shrink-0 sm:w-auto">
          <Icon name="Plus" size={16} className="mr-2" />
          {isAdmin ? 'Заявка за цех' : 'Запросить материал'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isAdmin ? 'Заявка за цех' : 'Запросить материал'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {isAdmin && (
            <>
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Заявка уйдёт кладовщику с пометкой «Заявка от админа» — в списке будет видно,
                что её оформили вы, а не смена.
              </p>
              <div className="space-y-1.5">
                <Label>Цех</Label>
                <Select value={reqWorkshopId} onValueChange={(v) => setReqWorkshopId?.(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите цех" />
                  </SelectTrigger>
                  <SelectContent>
                    {workshops.map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Смена</Label>
                <Select
                  value={reqShiftNumber}
                  onValueChange={(v) => setReqShiftNumber?.(v)}
                  disabled={!selectedWorkshop}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={selectedWorkshop ? 'Выберите смену' : 'Сначала выберите цех'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {shiftOptions.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {selectedWorkshop?.shiftNames?.[n - 1] || `Смена № ${n}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label>Материал</Label>
            <Select value={reqMaterialId} onValueChange={setReqMaterialId}>
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
          <p className="text-xs text-muted-foreground">
            Кладовщик сам определит количество и рулоны — просто выберите материал и отправьте заявку.
          </p>

          <div className="space-y-1.5">
            <Label>Комментарий</Label>
            <Textarea value={reqComment} onChange={(e) => setReqComment(e.target.value)} rows={2} />
          </div>

          <Button className="w-full" onClick={onCreate} disabled={creating}>
            {creating ? 'Отправка...' : 'Отправить заявку на склад'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RequestMaterialDialog;
