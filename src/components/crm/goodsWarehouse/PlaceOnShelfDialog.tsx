import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { placeOnShelf, type GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';

interface PlaceOnShelfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Вещи, забранные из цеха, но ещё не разложенные по полкам.
   *
   * Именно вещи, а не их количество: раньше кладовщик видел только цифру «ждут укладки: 7»
   * и шёл в цех вслепую — какая ткань, какой размер, от какого заказа, непонятно.
   * Найти нужное среди похожих вещей по одному числу невозможно. */
  pendingItems: GoodsWarehouseItem[];
  onDone: () => void;
}

/**
 * Раскладка по полкам вещей, отменённых клиентом.
 *
 * Кладовщик забрал их из цеха (упаковщик уже наклеил стикер хранения) и сканирует
 * один за другим. Полку выбирать не нужно — её называет система: однотипный товар
 * кладётся вместе, ходовой ближе, переполненная полка пропускается.
 *
 * Приём осмотренных из цеха — отдельная плитка на складе: это другая работа и
 * другой поток вещей, смешивать их в одном окне оказалось неудобно.
 */
const PlaceOnShelfDialog = ({
  open,
  onOpenChange,
  pendingItems,
  onDone,
}: PlaceOnShelfDialogProps) => {
  const pendingCount = pendingItems.length;
  const { toast } = useToast();
  const [barcode, setBarcode] = useState('');
  const [saving, setSaving] = useState(false);
  const [placed, setPlaced] = useState<string[]>([]);

  const handleSave = async () => {
    if (!barcode.trim()) return;
    setSaving(true);
    try {
      const scanned = barcode.trim();
      const res = await placeOnShelf(scanned);
      // Подписываем положенную вещь тканью и размером — по названию товара их не
      // различить, а кладовщику важно видеть, что именно он сейчас убрал на полку.
      const item = pendingItems.find((i) => i.storageBarcode === scanned);
      const title =
        item && item.material && item.width && item.height
          ? `${item.material} ${item.width}×${item.height}`
          : res.product || '';
      setPlaced((prev) =>
        [
          [res.orderNumber, title, `→ ${res.shelfName}`].filter(Boolean).join(' · '),
          ...prev,
        ].slice(0, 8),
      );
      // Полку называем крупно и отдельно: это команда, куда нести вещь.
      toast({
        title: `На полку «${res.shelfName}»`,
        description: res.shelfReason,
      });
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

  useScannerAutoSubmit(barcode, handleSave, !saving);

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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Разложить по полкам</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Ждут укладки: <span className="font-semibold text-foreground">{pendingCount}</span>.
            Сканируйте стикеры хранения — полку система назовёт сама.
          </p>

          {/* Что именно нужно забрать из цеха: ткань, размер, номер заказа и стикер
              хранения. Без этого списка кладовщик шёл к упаковщицам с одной цифрой
              и не мог отличить нужную вещь от десятка похожих. */}
          {pendingCount > 0 && (
            <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-md border border-border p-3">
              <p className="text-sm font-medium">Забрать из цеха</p>
              {pendingItems.map((i) => (
                <div key={i.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">
                      {[i.material, i.width && i.height ? `${i.width}×${i.height}` : null]
                        .filter(Boolean)
                        .join(' ') || i.product || '—'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Отменён клиентом
                      {i.orderNumber ? ` · заказ ${i.orderNumber}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono-tech text-xs text-muted-foreground">
                    {i.storageBarcode}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Стикер хранения</Label>
            <Input
              autoFocus
              placeholder="Отсканируйте стикер"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              className="h-11 font-mono-tech"
            />
          </div>

          {placed.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-border p-3">
              <p className="text-sm font-medium">Положено: {placed.length}</p>
              {placed.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon name="Check" size={14} className="text-emerald-600" />
                  {p}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PlaceOnShelfDialog;
