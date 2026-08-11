import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { printStorageStickers } from '@/lib/printStorageSticker';

interface AdminReceiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shelves: Shelf[];
  onDone: () => void;
}

/** Строка поиска товара: «вуаль 300 250» найдёт «Вуаль 300x250» — разделители не важны. */
const normalize = (s: string) => s.toLowerCase().replace(/[^a-zа-я0-9]+/gi, ' ').trim();

/** Позиция корзины: что принимаем и сколько штук. */
interface CartRow {
  item: MarketplaceItem;
  qty: number;
}

/**
 * Ручной приём товара на склад — сразу пачкой.
 *
 * Админ принимает излишек с производства или найденные вещи: набирает в корзину несколько
 * позиций с количеством, жмёт одну кнопку — все вещи заводятся на склад, и тут же печатается
 * ЛЕНТА стикеров хранения на всю партию.
 *
 * Раньше можно было принять только одну вещь за раз и печатать наклейки по одной: на партии
 * из десятка позиций это превращалось в десятки кликов по диалогу принтера.
 */
const AdminReceiveDialog = ({ open, onOpenChange, shelves, onDone }: AdminReceiveDialogProps) => {
  const { toast } = useToast();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartRow[]>([]);
  const [shelfId, setShelfId] = useState('');
  const [saving, setSaving] = useState(false);
  /** Печатать ленту стикеров сразу после приёмки — обычно это и нужно. */
  const [autoPrint, setAutoPrint] = useState(true);

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

  const totalPieces = cart.reduce((sum, r) => sum + r.qty, 0);

  const addToCart = (item: MarketplaceItem) => {
    setCart((prev) => {
      const exists = prev.find((r) => r.item.id === item.id);
      // Повторный клик по товару — не дубликат строки, а +1 к количеству.
      if (exists) {
        return prev.map((r) => (r.item.id === item.id ? { ...r, qty: r.qty + 1 } : r));
      }
      return [...prev, { item, qty: 1 }];
    });
  };

  const setQty = (id: number, qty: number) =>
    setCart((prev) =>
      prev.map((r) => (r.item.id === id ? { ...r, qty: Math.max(1, Math.min(99, qty)) } : r))
    );

  const removeRow = (id: number) => setCart((prev) => prev.filter((r) => r.item.id !== id));

  const reset = () => {
    setQuery('');
    setCart([]);
    setShelfId('');
  };

  const handleSave = async () => {
    if (!cart.length) return;
    setSaving(true);
    try {
      // Каждая позиция уходит ОДНИМ запросом со своим количеством, а сервер заводит все
      // штуки в одной транзакции. Раньше фронт слал запрос на каждую штуку — параллельные
      // запросы делили один служебный номер заказа, часть падала, и на складе оказывалось
      // меньше вещей, чем напечатано стикеров.
      const printed: { storageBarcode: string; title: string; orderNumber: string }[] = [];
      let failed = 0;

      for (const row of cart) {
        try {
          const res = await adminReceiveGoods(
            row.item.id,
            shelfId ? Number(shelfId) : undefined,
            row.qty
          );
          const list = res.created?.length ? res.created : [res];
          list.forEach((g) =>
            printed.push({
              storageBarcode: g.storageBarcode,
              title: g.product || res.product,
              orderNumber: g.orderNumber,
            })
          );
          // Стикеры печатаем только на реально заведённые вещи.
          failed += Math.max(0, row.qty - list.length);
        } catch {
          failed += row.qty;
        }
      }

      if (printed.length && autoPrint) {
        printStorageStickers(printed);
      }

      toast({
        title: `Принято вещей: ${printed.length}`,
        description: failed
          ? `Не удалось принять: ${failed}`
          : autoPrint
            ? 'Лента стикеров хранения отправлена на печать'
            : 'Стикеры можно напечатать из списка склада',
        variant: failed ? 'destructive' : undefined,
      });

      reset();
      onDone();
      if (printed.length) onOpenChange(false);
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
        if (!v) reset();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Принять товары на склад вручную</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Для вещей без заказа с маркетплейса — излишек с производства или найденный товар.
            Наберите позиции с количеством: система заведёт каждую вещь отдельно и напечатает
            ленту стикеров хранения
          </p>

          <div className="space-y-1.5">
            <Label>Найти товар</Label>
            <Input
              autoFocus
              placeholder="Например: вуаль 300x250"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {query.trim() && (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {found.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">
                  Ничего не найдено. Проверьте название или добавьте товар в справочник
                </p>
              ) : (
                found.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => addToCart(i)}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition hover:bg-muted"
                  >
                    <span className="font-medium">{i.name}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {i.material} {i.width}×{i.height}
                      <Icon name="Plus" size={14} />
                    </span>
                  </button>
                ))
              )}
            </div>
          )}

          {/* Корзина приёмки: что и по сколько штук заводим на склад. */}
          {cart.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>К приёмке</Label>
                <span className="text-sm text-muted-foreground">
                  позиций {cart.length} · вещей {totalPieces}
                </span>
              </div>
              <div className="max-h-56 space-y-1.5 overflow-y-auto">
                {cart.map((r) => (
                  <div
                    key={r.item.id}
                    className="flex items-center gap-2 rounded-md border border-border p-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.item.material} {r.item.width}×{r.item.height}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setQty(r.item.id, r.qty - 1)}
                      aria-label="Меньше"
                    >
                      <Icon name="Minus" size={14} />
                    </Button>
                    <Input
                      value={r.qty}
                      onChange={(e) => setQty(r.item.id, Number(e.target.value) || 1)}
                      className="h-9 w-14 text-center"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setQty(r.item.id, r.qty + 1)}
                      aria-label="Больше"
                    >
                      <Icon name="Plus" size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeRow(r.item.id)}
                      aria-label="Убрать"
                    >
                      <Icon name="X" size={16} />
                    </Button>
                  </div>
                ))}
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

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={(e) => setAutoPrint(e.target.checked)}
              className="h-4 w-4"
            />
            Сразу напечатать ленту стикеров хранения
          </label>

          <Button className="w-full" size="lg" onClick={handleSave} disabled={saving || !cart.length}>
            {saving ? (
              <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
            ) : (
              <Icon name="PackagePlus" size={16} className="mr-2" />
            )}
            Принять на склад{totalPieces > 0 ? ` (${totalPieces})` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AdminReceiveDialog;
