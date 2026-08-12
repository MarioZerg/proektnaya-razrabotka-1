import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchMarketplaceReturns,
  pickupMarketplaceReturns,
  type MarketplaceReturn,
} from '@/lib/marketplaceReturnsApi';

interface PickupReturnsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/**
 * Приёмка возвратов, привезённых с пункта выдачи.
 *
 * Отмечаем ТОЛЬКО то, что реально привезли. Раньше кнопка забирала всё, что числится
 * в пункте выдачи, — а возвраты капают туда весь день: пока кладовщик ехал обратно,
 * там набегали новые. В итоге на складе повисало 52 вещи вместо привезённых 25, то
 * есть недостача на ровном месте. Сколько коробок в машине, знает только человек.
 *
 * Остальное останется ждать в пункте выдачи до следующей поездки.
 */
const PickupReturnsDialog = ({ open, onOpenChange, onDone }: PickupReturnsDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [items, setItems] = useState<MarketplaceReturn[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSelected([]);
    setSearch('');
    // Забирать можно то, что физически лежит в пункте выдачи.
    fetchMarketplaceReturns({ status: 'new' })
      .then((d) =>
        setItems(
          (d.returns || []).filter(
            (r) => r.mpStatus === 'В пункте выдачи' || r.mpStatus === 'Получен'
          )
        )
      )
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

  const visible = items.filter((r) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [r.externalId, r.postingNumber, r.productName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  });

  const toggle = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleAllVisible = () =>
    setSelected((prev) =>
      visible.every((r) => prev.includes(r.id))
        ? prev.filter((id) => !visible.some((r) => r.id === id))
        : Array.from(new Set([...prev, ...visible.map((r) => r.id)]))
    );

  const handleSave = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      const res = await pickupMarketplaceReturns(selected, user?.id, user?.name);
      toast({
        title: `Принято возвратов: ${res.picked}`,
        description:
          res.remaining > 0
            ? `Заведено на склад: ${res.stocked}. Осталось завести: ${res.remaining} — нажмите ещё раз.`
            : 'Вещи на складе — разберите их: в цех на осмотр или на полку',
      });
      onDone();
      if (res.remaining === 0) onOpenChange(false);
    } catch (e) {
      toast({
        title: 'Не удалось принять',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Что привезли с пункта выдачи?</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Отметьте только те вещи, которые реально забрали. Остальные останутся ждать
            в пункте выдачи до следующей поездки.
          </p>

          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск: номер возврата, отправления или товар"
            autoComplete="off"
          />

          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="sm" onClick={toggleAllVisible} disabled={loading}>
              <Icon name="ListChecks" size={15} className="mr-1.5" />
              {visible.every((r) => selected.includes(r.id)) && visible.length > 0
                ? 'Снять выделение'
                : 'Отметить всё в списке'}
            </Button>
            <span className="text-sm font-medium">Выбрано: {selected.length}</span>
          </div>

          <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {loading ? (
              <div className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
                <Icon name="Loader2" size={15} className="animate-spin" />
                Загрузка...
              </div>
            ) : visible.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">
                В пункте выдачи пусто
              </p>
            ) : (
              visible.map((r) => (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-start gap-2 rounded p-1.5 hover:bg-muted/60"
                >
                  <Checkbox
                    checked={selected.includes(r.id)}
                    onCheckedChange={() => toggle(r.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {r.productName || 'Возврат'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      №{r.externalId}
                      {r.postingNumber ? ` · отправление ${r.postingNumber}` : ''}
                    </p>
                  </div>
                </label>
              ))
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button onClick={handleSave} disabled={saving || selected.length === 0}>
              {saving && <Icon name="Loader2" size={16} className="mr-2 animate-spin" />}
              Принять ({selected.length})
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PickupReturnsDialog;
