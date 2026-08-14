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
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { useAuth } from '@/context/AuthContext';
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
  const { user } = useAuth();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartRow[]>([]);
  const [shelfId, setShelfId] = useState('');
  const [saving, setSaving] = useState(false);
  /** Поле для пистолета: сюда пикают FBO-стикер с коробки/вещи. */
  const [scan, setScan] = useState('');
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
    // Без выбранной полки товар не ищем: класть его будет некуда.
    if (!q || !shelfId) return [];
    const words = q.split(' ');
    return items
      .filter((i) => {
        const haystack = normalize(
          `${i.name} ${i.material || ''} ${i.width || ''} ${i.height || ''} ${i.article || ''}`,
        );
        return words.every((w) => haystack.includes(w));
      })
      .slice(0, 20);
  }, [items, query, shelfId]);

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

  /**
   * Скан FBO-стикера. На стикере напечатан штрихкод товара — тот же, что лежит в карточке
   * товара на маркетплейсе (barcode вида OZN1579985267), либо артикул продавца / SKU
   * маркетплейса. Пикаем любой из них: кладовщику не нужно знать, что именно закодировано
   * в конкретном стикере — сверяем со всеми колонками сразу.
   *
   * Найденный товар просто падает в корзину, как если бы его выбрали руками. Повторный
   * скан того же стикера — это ещё одна такая же вещь, поэтому счётчик растёт на единицу.
   */
  const handleScan = () => {
    const code = scan.trim();
    if (!code) return;
    const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();
    const target = code.toLowerCase();
    const item = items.find(
      (i) =>
        norm(i.barcode) === target ||
        norm(i.article) === target ||
        norm(i.ozonSku) === target ||
        norm(i.wbSku) === target ||
        norm(i.ymSku) === target,
    );
    if (!item) {
      toast({
        title: 'Стикер не распознан',
        description: `Товар со штрихкодом ${code} не найден в справочнике маркетплейса`,
        variant: 'destructive',
      });
      setScan('');
      return;
    }
    addToCart(item);
    toast({ title: 'Добавлено', description: item.name });
    setScan('');
  };

  // Пистолет вводит код мгновенно и без Enter — ловим конец ввода по паузе.
  useScannerAutoSubmit(scan, handleScan, Boolean(shelfId) && !saving);

  const setQty = (id: number, qty: number) =>
    setCart((prev) =>
      prev.map((r) => (r.item.id === id ? { ...r, qty: Math.max(1, Math.min(99, qty)) } : r))
    );

  const removeRow = (id: number) => setCart((prev) => prev.filter((r) => r.item.id !== id));

  const reset = () => {
    setQuery('');
    setCart([]);
    setShelfId('');
    setScan('');
  };

  const handleSave = async () => {
    if (!cart.length || !shelfId) return;
    setSaving(true);
    try {
      // Каждая позиция уходит ОДНИМ запросом со своим количеством, а сервер заводит все
      // штуки в одной транзакции. Раньше фронт слал запрос на каждую штуку — параллельные
      // запросы делили один служебный номер заказа, часть падала, и на складе оказывалось
      // меньше вещей, чем напечатано стикеров.
      const printed: {
        storageBarcode: string;
        title: string;
        orderNumber: string;
        status: string;
      }[] = [];
      let failed = 0;

      for (const row of cart) {
        try {
          const res = await adminReceiveGoods(
            row.item.id,
            Number(shelfId),
            row.qty,
            user?.id,
            user?.name,
          );
          const list = res.created?.length ? res.created : [res];
          list.forEach((g) =>
            printed.push({
              storageBarcode: g.storageBarcode,
              title: g.product || res.product,
              orderNumber: g.orderNumber,
              status: g.status,
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

      // Часть принятых вещей система тут же забирает под ожидающие заказы — они уходят
      // в «На сборке». Без этой строки кладовщик открывал склад с фильтром «На хранении»,
      // видел там меньше вещей, чем принял, и думал, что приёмка сработала не полностью.
      const toPicking = printed.filter((p) => p.status === 'picking').length;
      const parts: string[] = [];
      if (toPicking) parts.push(`${toPicking} сразу ушло в сборку под заказы`);
      if (failed) parts.push(`не удалось принять: ${failed}`);
      if (autoPrint) parts.push('лента стикеров отправлена на печать');

      toast({
        title: `Принято вещей: ${printed.length}`,
        description: parts.join(' · ') || 'Все вещи лежат на выбранной полке',
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
            Пикайте FBO-стикер каждой вещи: система сама определит товар, заведёт вещи на
            выбранную полку и напечатает ленту стикеров хранения
          </p>

          {/* Полка выбирается ПЕРВОЙ и обязательна: вещь, принятая без полки, повисает
              в статусе «Ждёт полку» — по факту она уже лежит на складе, но найти её
              нельзя, пока кладовщик отдельно не отсканирует её на полку. */}
          <div className="space-y-1.5">
            <Label>Полка</Label>
            <Select value={shelfId} onValueChange={setShelfId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите полку, куда кладёте товар" />
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

          {/* Основной способ приёмки: кладовщик пикает FBO-стикер, товар определяется сам.
              Поиск руками ниже остаётся запасным вариантом — на случай стёртого стикера. */}
          <div className="space-y-1.5">
            <Label>Скан FBO-стикера</Label>
            <Input
              autoFocus
              placeholder="Наведите сканер на стикер"
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleScan();
                }
              }}
              disabled={!shelfId || saving}
            />
            <p className="text-xs text-muted-foreground">
              {shelfId
                ? 'Товар определится по стикеру и добавится в список. Один скан — одна вещь'
                : 'Сначала выберите полку'}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Или найти товар вручную</Label>
            <Input
              placeholder="Например: вуаль 300x250"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={!shelfId}
            />
            {!shelfId && (
              <p className="text-xs text-muted-foreground">
                Сначала выберите полку — товар кладётся сразу на неё
              </p>
            )}
          </div>

          {shelfId && query.trim() && (
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

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoPrint}
              onChange={(e) => setAutoPrint(e.target.checked)}
              className="h-4 w-4"
            />
            Сразу напечатать ленту стикеров хранения
          </label>

          <Button
            className="w-full"
            size="lg"
            onClick={handleSave}
            disabled={saving || !cart.length || !shelfId}
          >
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