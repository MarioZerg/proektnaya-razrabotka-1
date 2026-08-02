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
import type { Shelf } from '@/lib/shelvesApi';

interface MoveShelfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCreate: () => void;
  shelves: Shelf[];
  barcode: string;
  setBarcode: (value: string) => void;
  shelfId: string;
  setShelfId: (value: string) => void;
  saving: boolean;
  onSave: () => void;
}

const MoveShelfDialog = ({
  open,
  onOpenChange,
  onOpenCreate,
  shelves,
  barcode,
  setBarcode,
  shelfId,
  setShelfId,
  saving,
  onSave,
}: MoveShelfDialogProps) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" onClick={onOpenCreate}>
          <Icon name="ArrowLeftRight" size={16} className="mr-2" />
          Смена полки
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Смена полки товара</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Штрихкод хранения</Label>
            <Input
              autoFocus
              placeholder="Отсканируйте штрихкод хранения"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && barcode.trim() && shelfId && onSave()}
              className="font-mono-tech"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Новая полка</Label>
            <Select value={shelfId} onValueChange={setShelfId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите полку" />
              </SelectTrigger>
              <SelectContent>
                {shelves.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" onClick={onSave} disabled={saving || !barcode.trim() || !shelfId}>
            {saving ? 'Сохранение...' : 'Переместить'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MoveShelfDialog;
