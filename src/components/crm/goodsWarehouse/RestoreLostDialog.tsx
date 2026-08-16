import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { restoreLostGoods } from '@/lib/goodsWarehouseApi';
import { fetchShelves, type Shelf } from '@/lib/shelvesApi';

interface RestoreLostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goodsId: number;
  title: string;
  storageBarcode: string;
  /** Полка, на которой вещь числилась до списания. */
  currentShelfName?: string | null;
  onDone: () => void;
}

/**
 * «Товар нашёлся» — возвращаем списанную вещь на полку хранения.
 *
 * Списание не всегда означает утрату: вещь могли переложить на соседнюю полку, унести
 * на осмотр и не отметить, или кладовщик просто не нашёл её в тот день. Раньше запись
 * оставалась мёртвой навсегда, и вещь приходилось заводить заново с новым стикером —
 * история движения при этом обрывалась.
 *
 * Вещь возвращается СВОБОДНЫМ остатком: заказ, который за ней стоял, уже уехал в цех и
 * сшит заново, поэтому бронь не восстанавливаем — иначе покупателю уехали бы две вещи.
 * Дальше автоподбор сам закроет ею подходящий заказ.
 */
const RestoreLostDialog = ({
  open,
  onOpenChange,
  goodsId,
  title,
  storageBarcode,
  currentShelfName,
  onDone,
}: RestoreLostDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [shelfId, setShelfId] = useState<string>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchShelves()
      .then(setShelves)
      .catch(() => setShelves([]));
  }, [open]);

  const handleRestore = async () => {
    setSaving(true);
    try {
      const res = await restoreLostGoods(
        goodsId,
        shelfId ? Number(shelfId) : null,
        note.trim(),
        user?.id,
        user?.name,
      );
      toast({
        title: 'Товар вернулся на склад',
        description: [
          res.shelfName ? `Лежит на полке «${res.shelfName}»` : 'Вещь снова на хранении',
          res.matched > 0 ? `Сразу закрыто заказов: ${res.matched}` : null,
        ]
          .filter(Boolean)
          .join('. '),
      });
      setNote('');
      setShelfId('');
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось вернуть товар',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setNote('');
          setShelfId('');
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Товар нашёлся</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <div className="font-medium">{title}</div>
            <div className="mt-0.5 font-mono-tech text-xs text-muted-foreground">
              {storageBarcode}
            </div>
          </div>

          {/* Объясняем, что вещь вернётся СВОБОДНОЙ. Админ может ждать, что вернётся и
              старый заказ, — но тот уже шьётся заново, и вторая вещь покупателю не нужна. */}
          <div className="flex gap-2 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
            <Icon name="Info" size={18} className="mt-0.5 shrink-0" />
            <div>
              Вещь вернётся на полку свободным остатком. Прежний заказ не восстановится —
              он уже ушёл в цех. Система сама подберёт вещь под подходящий новый заказ.
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Полка</Label>
            <Select value={shelfId} onValueChange={setShelfId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    currentShelfName
                      ? `Оставить прежнюю: «${currentShelfName}»`
                      : 'Выберите полку'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {shelves.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Не выбирать — вещь останется на прежней полке
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rl-note">Где нашлась (необязательно)</Label>
            <Textarea
              id="rl-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Например: лежала на соседней полке"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={handleRestore} disabled={saving}>
              {saving ? (
                <Icon name="Loader2" size={16} className="mr-1.5 animate-spin" />
              ) : (
                <Icon name="PackageCheck" size={16} className="mr-1.5" />
              )}
              Вернуть на полку
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RestoreLostDialog;
