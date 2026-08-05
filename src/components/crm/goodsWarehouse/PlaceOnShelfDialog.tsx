import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import type { Shelf } from '@/lib/shelvesApi';
import { placeOnShelf } from '@/lib/goodsWarehouseApi';

interface PlaceOnShelfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shelves: Shelf[];
  /** Сколько вещей забрано из цеха, но ещё не разложено по полкам. */
  pendingCount: number;
  onDone: () => void;
}

/** Кладовщик забрал из цеха вещи, отменённые клиентом (упаковщик наклеил стикер хранения),
 * и раскладывает их по полкам: выбирает полку один раз и сканирует стикеры один за другим. */
const PlaceOnShelfDialog = ({
  open,
  onOpenChange,
  shelves,
  pendingCount,
  onDone,
}: PlaceOnShelfDialogProps) => {
  const { toast } = useToast();
  const [barcode, setBarcode] = useState('');
  const [shelfId, setShelfId] = useState('');
  const [saving, setSaving] = useState(false);
  const [placed, setPlaced] = useState<string[]>([]);

  const handleSave = async () => {
    if (!barcode.trim() || !shelfId) return;
    setSaving(true);
    try {
      const res = await placeOnShelf(barcode.trim(), Number(shelfId));
      setPlaced((prev) => [`${res.orderNumber || ''} · ${res.product || ''}`, ...prev].slice(0, 8));
      setBarcode('');
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось положить на полку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      setBarcode('');
    } finally {
      setSaving(false);
    }
  };

  useScannerAutoSubmit(barcode, handleSave, !!shelfId && !saving);

  const shelfName = shelves.find((s) => String(s.id) === shelfId)?.name;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setBarcode('');
          setPlaced([]);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Разложить отменённые товары по полкам</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Ждут укладки: <span className="font-semibold text-foreground">{pendingCount}</span>.
            Выберите полку и сканируйте стикеры хранения один за другим.
          </p>

          <div className="space-y-1.5">
            <Label>Полка</Label>
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

          <div className="space-y-1.5">
            <Label>Стикер хранения</Label>
            <Input
              autoFocus
              disabled={!shelfId}
              placeholder={shelfId ? 'Отсканируйте стикер' : 'Сначала выберите полку'}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              className="font-mono-tech"
            />
          </div>

          {placed.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-border p-3">
              <p className="text-sm font-medium">
                Положено на «{shelfName}»: {placed.length}
              </p>
              {placed.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon name="Check" size={14} className="text-emerald-600" />
                  {p}
                </div>
              ))}
            </div>
          )}

          {pendingCount === 0 && placed.length === 0 && (
            <Badge variant="secondary" className="w-full justify-center py-2">
              Все отменённые товары разложены
            </Badge>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PlaceOnShelfDialog;
