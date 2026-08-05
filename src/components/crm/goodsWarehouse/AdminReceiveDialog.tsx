import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
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
import type { Shelf } from '@/lib/shelvesApi';
import { fetchMarketplaceItems, type MarketplaceItem } from '@/lib/marketplaceItemsApi';
import { adminReceiveGoods } from '@/lib/goodsWarehouseApi';

interface AdminReceiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shelves: Shelf[];
  onDone: () => void;
}

/** Строка поиска товара: «вуаль 300 250» найдёт «Вуаль 300x250» — разделители не важны. */
const normalize = (s: string) => s.toLowerCase().replace(/[^a-zа-я0-9]+/gi, ' ').trim();

/** Ручной приём товара администратором: он ищет товар по названию и размеру и кладёт вещь на
 * склад хранения без заказа с маркетплейса (излишек производства, найденная вещь). */
const AdminReceiveDialog = ({ open, onOpenChange, shelves, onDone }: AdminReceiveDialogProps) => {
  const { toast } = useToast();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [shelfId, setShelfId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetchMarketplaceItems()
      .then(setItems)
      .catch(() => setItems([]));
  }, [open]);

  const found = useMemo(() => {
    const q = normalize(query);
    if (!q) return [];
    const words = q.split(' ');
    return items
      .filter((i) => {
        const haystack = normalize(
          `${i.name} ${i.material || ''} ${i.width || ''} ${i.height || ''} ${i.article || ''}`,
        );
        return words.every((w) => haystack.includes(w));
      })
      .slice(0, 20);
  }, [items, query]);

  const selected = items.find((i) => i.id === selectedId) || null;

  const handleSave = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const res = await adminReceiveGoods(selectedId, shelfId ? Number(shelfId) : undefined);
      toast({
        title: `Принято: ${res.product}`,
        description:
          res.status === 'in_stock'
            ? `Стикер ${res.storageBarcode} — товар на полке`
            : `Стикер ${res.storageBarcode} — положите на полку сканированием`,
      });
      setQuery('');
      setSelectedId(null);
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast({
        title: 'Не удалось принять товар',
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
        onOpenChange(v);
        if (!v) {
          setQuery('');
          setSelectedId(null);
          setShelfId('');
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Принять товар на склад вручную</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Для вещей без заказа с маркетплейса — излишек с производства или найденный товар.
            Такие приёмы помечаются как добавленные администратором.
          </p>

          <div className="space-y-1.5">
            <Label>Найти товар</Label>
            <Input
              autoFocus
              placeholder="Например: вуаль 300x250"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedId(null);
              }}
            />
          </div>

          {query.trim() && (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {found.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">
                  Ничего не найдено. Проверьте название или добавьте товар в справочник
                </p>
              ) : (
                found.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => setSelectedId(i.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition ${
                      selectedId === i.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                    }`}
                  >
                    <span className="font-medium">{i.name}</span>
                    <span className="shrink-0 text-xs opacity-80">
                      {i.material} {i.width}×{i.height}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {selected && (
            <div className="rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="bg-violet-100 text-violet-700">
                  Выбрано
                </Badge>
                <span className="font-medium">{selected.name}</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Полка (необязательно)</Label>
            <Select value={shelfId || 'none'} onValueChange={(v) => setShelfId(v === 'none' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Положу на полку сканированием" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Положу на полку сканированием</SelectItem>
                {shelves.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button className="w-full" onClick={handleSave} disabled={saving || !selectedId}>
            {saving ? (
              <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
            ) : (
              <Icon name="PackagePlus" size={16} className="mr-2" />
            )}
            Принять на склад хранения
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AdminReceiveDialog;
