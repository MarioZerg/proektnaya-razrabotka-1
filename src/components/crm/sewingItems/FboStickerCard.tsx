import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { updateOrder, type Order, type OrderDetail } from '@/lib/ordersApi';
import { fetchMarketplaceItems, type MarketplaceItem } from '@/lib/marketplaceItemsApi';
import { printFboSticker } from '@/lib/printFboSticker';

interface FboStickerCardProps {
  order: Order;
  orderDetail: OrderDetail | null;
  /** Вызывается после привязки товара, чтобы перезагрузить заказ (штрихкод/товар). */
  onSaved: () => void;
}

/**
 * Карточка стикера FBO в детали заказа. Позволяет выбрать конкретный товар из справочника
 * (на один размер бывает несколько товаров с разными штрихкодами), фиксирует штрихкод в заказе
 * и печатает стикер FBO 58×40 мм. Показывается только для готовых FBO-заказов OZON.
 */
const FboStickerCard = ({ order, orderDetail, onSaved }: FboStickerCardProps) => {
  const { toast } = useToast();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchMarketplaceItems().then(setItems).catch(() => setItems([]));
  }, []);

  // Кандидаты — товары того же материала и размера, что и заказ. Именно среди них выбираем,
  // какой штрихкод печатать (на один размер может приходиться несколько артикулов OZON).
  const candidates = useMemo(
    () =>
      items.filter(
        (i) =>
          (!order.material || i.material === order.material) &&
          (order.width == null || i.width === order.width) &&
          (order.height == null || i.height === order.height)
      ),
    [items, order.material, order.width, order.height]
  );

  const selectedItemId = orderDetail?.marketplaceItemId ?? null;
  const barcode = order.productBarcode || null;
  const selectedItem = selectedItemId ? items.find((i) => i.id === selectedItemId) ?? null : null;

  const handleSelect = async (value: string) => {
    setSaving(true);
    try {
      await updateOrder(order.id, { marketplaceItemId: Number(value) });
      toast({ title: 'Товар привязан', description: 'Штрихкод для стикера сохранён' });
      onSaved();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Стикер FBO</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label>Товар маркетплейса (определяет штрихкод)</Label>
          {selectedItemId ? (
            // Товар уже привязан — менять его нельзя, показываем как есть.
            <div className="rounded border border-border px-3 py-2 text-sm">
              {selectedItem ? (
                <>
                  {selectedItem.ozonSku && (
                    <span className="text-muted-foreground">OZON {selectedItem.ozonSku} · </span>
                  )}
                  {selectedItem.name}
                </>
              ) : (
                <span className="text-muted-foreground">Товар привязан</span>
              )}
            </div>
          ) : (
            <Select value="" onValueChange={handleSelect} disabled={saving}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите товар" />
              </SelectTrigger>
              <SelectContent>
                {candidates.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                    Нет подходящих товаров в справочнике
                  </div>
                ) : (
                  candidates.map((i) => (
                    <SelectItem key={i.id} value={String(i.id)}>
                      {i.barcode ? `${i.barcode} — ` : ''}
                      {i.ozonSku ? `OZON ${i.ozonSku} · ` : ''}
                      {i.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          )}
        </div>

        {barcode ? (
          <div className="flex items-center justify-between gap-2 rounded border border-border p-2">
            <div className="text-sm">
              <div className="text-muted-foreground">Штрихкод товара</div>
              <div className="font-mono-tech font-semibold">{barcode}</div>
            </div>
            <Button size="sm" onClick={() => printFboSticker(order)}>
              <Icon name="Printer" size={14} className="mr-1.5" />
              Печать стикера
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Выберите товар, чтобы загрузить штрихкод и распечатать стикер FBO.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default FboStickerCard;