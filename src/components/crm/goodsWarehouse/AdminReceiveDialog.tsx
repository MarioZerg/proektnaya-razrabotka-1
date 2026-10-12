import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { useAuth } from '@/context/AuthContext';
import type { Shelf } from '@/lib/shelvesApi';
import { fetchMarketplaceItems, type MarketplaceItem, type Shop } from '@/lib/marketplaceItemsApi';
import {
  adminReceiveGoods,
  fetchGoodsByBarcode,
  findItemByCode,
} from '@/lib/goodsWarehouseApi';
import { printStorageStickers } from '@/lib/printStorageSticker';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import AdminReceiveSetup from '@/components/crm/goodsWarehouse/adminReceive/AdminReceiveSetup';
import AdminReceiveSizePicker from '@/components/crm/goodsWarehouse/adminReceive/AdminReceiveSizePicker';
import AdminReceiveCart from '@/components/crm/goodsWarehouse/adminReceive/AdminReceiveCart';
import {
  SHELF_KEY,
  SHOP_KEY,
  type CartRow,
  type CatalogHit,
  type Step,
} from '@/components/crm/goodsWarehouse/adminReceive/adminReceiveShared';

interface AdminReceiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shelves: Shelf[];
  onDone: () => void;
}

/**
 * Ручной приём на склад.
 *
 * Магазин выбирается явно — по нему вещь потом видна в списке. Полка запоминается.
 * Товар без стикера набирается кнопками: материал, затем ширина, затем высота.
 * Высота и скан кладут строку в корзину сверху. На склад партия уходит по
 * «Подтвердить»: список остаётся, у каждой строки появляется GW. Ленту
 * печатают отдельно и сами закрывают окно. Пока его не откроют заново,
 * добавить ещё одну вещь нельзя.
 * Скан принимает любой наш стикер, кроме вещи, которая уже лежит на складе.
 */
const AdminReceiveDialog = ({ open, onOpenChange, shelves, onDone }: AdminReceiveDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [shopId, setShopId] = useState('');
  const [shelfId, setShelfId] = useState('');
  const [changeShelf, setChangeShelf] = useState(false);
  const [scan, setScan] = useState('');
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<Step>('material');
  const [material, setMaterial] = useState('');
  const [width, setWidth] = useState<number | null>(null);
  const [cart, setCart] = useState<CartRow[]>([]);
  /** Состав уже ушёл на склад: в этом открытии окна новые строки не принимаем. */
  const [confirmed, setConfirmed] = useState(false);

  const loadItems = () => {
    fetchMarketplaceItems()
      .then(({ items: list, shops: shopList }) => {
        setListError(null);
        setItems(list);
        setShops(shopList);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить товары');
      });
  };

  useEffect(() => {
    if (!open) return;
    loadItems();
    setShelfId(localStorage.getItem(SHELF_KEY) || '');
    setShopId(localStorage.getItem(SHOP_KEY) || '');
    setChangeShelf(false);
    setStep('material');
    setMaterial('');
    setWidth(null);
    setScan('');
    setCart([]);
    setConfirmed(false);
  }, [open]);

  useEffect(() => {
    if (!shelfId || !shelves.length) return;
    if (!shelves.some((s) => String(s.id) === shelfId)) {
      setShelfId('');
      localStorage.removeItem(SHELF_KEY);
    }
  }, [shelves, shelfId]);

  useEffect(() => {
    if (!shopId || !shops.length) return;
    if (!shops.some((s) => String(s.id) === shopId)) {
      setShopId('');
      localStorage.removeItem(SHOP_KEY);
    }
  }, [shops, shopId]);

  const shopItems = useMemo(
    () => items.filter((i) => i.shopId === Number(shopId) && i.material && i.width && i.height),
    [items, shopId],
  );
  const materials = useMemo(
    () => [...new Set(shopItems.map((i) => i.material as string))].sort((a, b) => a.localeCompare(b, 'ru')),
    [shopItems],
  );
  const widths = useMemo(
    () =>
      [...new Set(shopItems.filter((i) => i.material === material).map((i) => i.width as number))].sort(
        (a, b) => a - b,
      ),
    [shopItems, material],
  );
  const heights = useMemo(
    () =>
      [
        ...new Set(
          shopItems
            .filter((i) => i.material === material && i.width === width)
            .map((i) => i.height as number),
        ),
      ].sort((a, b) => a - b),
    [shopItems, material, width],
  );

  const shelfName = shelves.find((s) => String(s.id) === shelfId)?.name;

  const rememberShop = (id: number) => {
    setShopId(String(id));
    localStorage.setItem(SHOP_KEY, String(id));
    setStep('material');
    setMaterial('');
    setWidth(null);
  };

  const rememberShelf = (id: string) => {
    setShelfId(id);
    localStorage.setItem(SHELF_KEY, id);
    setChangeShelf(false);
  };

  const resetChoice = () => {
    setStep('material');
    setMaterial('');
    setWidth(null);
  };

  const addToCart = (hit: CatalogHit) => {
    if (confirmed) return;
    const title =
      hit.material && hit.width && hit.height
        ? `${hit.material} ${hit.width}×${hit.height}`
        : hit.name;
    setCart((prev) => [{ key: `${hit.id}-${Date.now()}-${prev.length}`, hit, title }, ...prev]);
    resetChoice();
  };

  const removeFromCart = (key: string) => setCart((prev) => prev.filter((row) => row.key !== key));

  const confirmCart = async () => {
    if (!cart.length || saving) return;
    if (!shelfId) {
      toast({ title: 'Сначала укажите полку', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const errors: string[] = [];
    const assigned = new Map<string, { storageBarcode: string; orderNumber: string }>();
    const groups = new Map<string, { hit: CatalogHit; keys: string[] }>();
    cart.forEach((row) => {
      const shop = row.hit.shopId || Number(shopId) || 0;
      const groupKey = `${row.hit.id}:${shop}`;
      const group = groups.get(groupKey) || { hit: row.hit, keys: [] };
      group.keys.push(row.key);
      groups.set(groupKey, group);
    });
    try {
      for (const group of groups.values()) {
        const shop = group.hit.shopId || Number(shopId) || undefined;
        try {
          const res = await adminReceiveGoods(
            group.hit.id,
            Number(shelfId),
            group.keys.length,
            user?.id,
            user?.name,
            shop,
          );
          const list = res.created?.length ? res.created : [res];
          list.forEach((g, index) => {
            const key = group.keys[index];
            if (!key || !g.storageBarcode) return;
            assigned.set(key, {
              storageBarcode: g.storageBarcode,
              orderNumber: g.orderNumber,
            });
          });
        } catch (e) {
          const raw = e instanceof Error ? e.message : '';
          const text = raw === 'Failed to fetch'
            ? 'Нет ответа от сервера. Приём этой позиции не завершился — проверьте склад и повторите'
            : (raw || 'Не удалось добавить');
          errors.push(`${group.hit.name}: ${text}`);
        }
      }
      if (assigned.size) {
        setCart((prev) =>
          prev.map((row) => {
            const gw = assigned.get(row.key);
            return gw ? { ...row, ...gw } : row;
          }),
        );
        setConfirmed(true);
        onDone();
        toast({
          title: `На складе: ${assigned.size}`,
          description: 'Номера GW в списке. Напечатайте ленту и закройте окно',
        });
      }
      if (errors.length) {
        toast({
          title: 'Часть товаров принять нельзя',
          description: errors.join('\n'),
          variant: 'destructive',
          duration: 15000,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const matchLocal = (raw: string): MarketplaceItem | null => {
    const code = raw.trim().toUpperCase();
    const bare = code.startsWith('OZN') ? code.slice(3) : code;
    const variants = new Set([code, bare, `OZN${bare}`, bare.replace(/^0+/, '')].filter(Boolean));
    const hit = (v: string | null | undefined) => Boolean(v && variants.has(v.trim().toUpperCase()));
    const matches = items.filter(
      (i) => hit(i.barcode) || hit(i.article) || hit(i.ozonSku) || hit(i.wbSku) || hit(i.ymSku),
    );
    if (!matches.length) return null;
    return matches.find((i) => i.shopId === Number(shopId)) || matches[0];
  };

  const printStrip = () => {
    const ready = cart.filter((row) => row.storageBarcode);
    if (!ready.length) return;
    printStorageStickers(
      ready.map((row) => ({
        storageBarcode: row.storageBarcode as string,
        title: row.title,
        orderNumber: row.orderNumber,
      })),
    );
  };

  const handleScan = async () => {
    const code = scan.trim();
    if (!code || scanning || saving || confirmed) return;
    setScanning(true);
    try {
      if (/^GW-/i.test(code)) {
        try {
          await fetchGoodsByBarcode(code);
          toast({
            title: 'Уже в системе',
            description: 'Этот стикер хранения уже заведён на склад',
            variant: 'destructive',
          });
        } catch {
          toast({
            title: 'Стикер не найден',
            description: 'Такого кода хранения в системе нет',
            variant: 'destructive',
          });
        }
        return;
      }

      let found: CatalogHit | null = null;
      try {
        const remote = await findItemByCode(code);
        const local = items.find((i) => i.id === remote.id);
        found = { ...remote, shopId: remote.shopId ?? local?.shopId ?? null };
      } catch (e) {
        const message = e instanceof Error ? e.message : '';
        if (message.includes('уже есть в системе')) throw e;
        found = matchLocal(code);
        if (!found) throw e;
      }
      if (found.shopId) rememberShop(found.shopId);
      addToCart(found);
    } catch (e) {
      toast({
        title: 'Стикер не распознан',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setScan('');
      setScanning(false);
    }
  };

  useScannerAutoSubmit(scan, handleScan, !saving && !scanning && !confirmed);

  const pickHeight = (height: number) => {
    const item = shopItems.find(
      (i) => i.material === material && i.width === width && i.height === height,
    );
    if (!item) {
      toast({
        title: 'Нет такой карточки',
        description: 'В этом магазине нет товара с таким материалом и размером',
        variant: 'destructive',
      });
      return;
    }
    addToCart(item);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent confirmClose={false} className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Принять товары на склад вручную</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {listError && (
            <WarehouseFetchError
              title="Не удалось загрузить товары"
              description={listError}
              onRetry={loadItems}
            />
          )}

          {!confirmed && (
          <>
          <AdminReceiveSetup
            shops={shops}
            shopId={shopId}
            onPickShop={rememberShop}
            shelves={shelves}
            shelfId={shelfId}
            shelfName={shelfName}
            changeShelf={changeShelf}
            onChangeShelf={() => setChangeShelf(true)}
            onPickShelf={rememberShelf}
            scan={scan}
            onScanChange={setScan}
            onScan={handleScan}
            saving={saving}
            scanning={scanning}
          />

          {shopId && (
            <AdminReceiveSizePicker
              step={step}
              material={material}
              width={width}
              materials={materials}
              widths={widths}
              heights={heights}
              saving={saving}
              onBack={() => {
                if (step === 'height') {
                  setStep('width');
                  setWidth(null);
                } else {
                  resetChoice();
                }
              }}
              onPickMaterial={(name) => {
                setMaterial(name);
                setWidth(null);
                setStep('width');
              }}
              onPickWidth={(value) => {
                setWidth(value);
                setStep('height');
              }}
              onPickHeight={pickHeight}
            />
          )}
          </>
          )}

          {confirmed && (
            <p className="text-sm text-muted-foreground">
              Состав принят. Напечатайте ленту и закройте окно. Чтобы добавить ещё, откройте приём заново
            </p>
          )}

          {cart.length > 0 && (
            <AdminReceiveCart
              cart={cart}
              confirmed={confirmed}
              saving={saving}
              onRemove={removeFromCart}
              onPrint={printStrip}
              onConfirm={confirmCart}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AdminReceiveDialog;
