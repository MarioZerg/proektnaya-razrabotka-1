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
}

// Заявку на материал в цех создаёт только сам сотрудник цеха (швея/закройщик/упаковщик) —
// цех и смена берутся из его профиля автоматически, кладовщик заявки не создаёт (он только
// собирает и отправляет то, что уже запросили). Сотрудник выбирает материал и отправляет —
// кладовщик сам определит количество и рулоны при сборке.
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
}: RequestMaterialDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button onClick={onOpenCreate} className="w-full sm:w-auto">
          <Icon name="Plus" size={16} className="mr-2" />
          Запросить материал
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Запросить материал</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
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