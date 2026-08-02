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
import type { Workshop } from '@/lib/workshopsApi';
import type { Material } from '@/lib/materialsApi';

interface RequestMaterialDialogProps {
  isProduction: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCreate: () => void;
  workshops: Workshop[];
  materials: Material[];
  reqWorkshopId: string;
  setReqWorkshopId: (value: string) => void;
  reqShiftNumber: string;
  setReqShiftNumber: (value: string) => void;
  reqMaterialId: string;
  setReqMaterialId: (value: string) => void;
  reqQuantity: string;
  setReqQuantity: (value: string) => void;
  reqComment: string;
  setReqComment: (value: string) => void;
  creating: boolean;
  onCreate: () => void;
}

const RequestMaterialDialog = ({
  isProduction,
  open,
  onOpenChange,
  onOpenCreate,
  workshops,
  materials,
  reqWorkshopId,
  setReqWorkshopId,
  reqShiftNumber,
  setReqShiftNumber,
  reqMaterialId,
  setReqMaterialId,
  reqQuantity,
  setReqQuantity,
  reqComment,
  setReqComment,
  creating,
  onCreate,
}: RequestMaterialDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button onClick={onOpenCreate}>
          <Icon name="Plus" size={16} className="mr-2" />
          {isProduction ? 'Запросить материал' : 'Новая заявка'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isProduction ? 'Запросить материал' : 'Заявка на материал в цех'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!isProduction && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Цех</Label>
                <Select
                  value={reqWorkshopId}
                  onValueChange={(v) => {
                    setReqWorkshopId(v);
                    setReqShiftNumber('');
                  }}
                >
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
                <Label>Смена (необязательно)</Label>
                <Select
                  value={reqShiftNumber || 'none'}
                  onValueChange={(v) => setReqShiftNumber(v === 'none' ? '' : v)}
                  disabled={!reqWorkshopId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Без смены" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Без смены</SelectItem>
                    {(workshops.find((w) => String(w.id) === reqWorkshopId)?.shiftNames ?? []).map(
                      (name, idx) => (
                        <SelectItem key={idx} value={String(idx + 1)}>
                          {name}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
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
          {isProduction ? (
            <p className="text-xs text-muted-foreground">
              Кладовщик сам определит количество и рулоны — просто выберите материал и отправьте заявку.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Количество (необязательно)</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Кол-во"
                  value={reqQuantity}
                  onChange={(e) => setReqQuantity(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">Одна заявка — один материал.</p>
            </>
          )}

          <div className="space-y-1.5">
            <Label>Комментарий</Label>
            <Textarea value={reqComment} onChange={(e) => setReqComment(e.target.value)} rows={2} />
          </div>

          <Button className="w-full" onClick={onCreate} disabled={creating}>
            {creating ? 'Отправка...' : isProduction ? 'Отправить заявку на склад' : 'Создать заявку'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RequestMaterialDialog;