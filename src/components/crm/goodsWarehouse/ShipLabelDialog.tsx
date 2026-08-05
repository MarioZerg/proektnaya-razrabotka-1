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
import { shipLabelGoods, type GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';

interface ShipLabelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Вещи с полок, подобранные под новые заказы FBS и ждущие стикера отправления. */
  matched: GoodsWarehouseItem[];
  onDone: () => void;
}

/** Кладовщик забирает с полки вещь, подобранную под новый заказ, клеит стикер отправления
 * маркетплейса и сканирует стикер хранения — после этого вещь можно сканировать в поставку. */
const ShipLabelDialog = ({ open, onOpenChange, matched, onDone }: ShipLabelDialogProps) => {
  const { toast } = useToast();
  const [barcode, setBarcode] = useState('');
  const [saving, setSaving] = useState(false);
  const [labeled, setLabeled] = useState<string[]>([]);

  const handleSave = async () => {
    if (!barcode.trim()) return;
    setSaving(true);
    try {
      const res = await shipLabelGoods(barcode.trim());
      setLabeled((prev) => [`${res.orderNumber} · ${res.product || ''}`, ...prev].slice(0, 8));
      setBarcode('');
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось отметить стикеровку',
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
          setLabeled([]);
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Стикеровка заказов с полок</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Эти товары уже лежат на складе и подобраны под новые заказы. Заберите вещь с полки,
            наклейте стикер отправления маркетплейса и отсканируйте стикер хранения.
          </p>

          {matched.length > 0 ? (
            <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-md border border-border p-3">
              {matched.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
                  <div>
                    <div className="font-medium">{m.reservedOrderNumber}</div>
                    <div className="text-xs text-muted-foreground">{m.product}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{m.shelfName || 'без полки'}</div>
                    <div className="font-mono-tech text-xs text-muted-foreground">
                      {m.storageBarcode}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-border p-3 text-center text-sm text-muted-foreground">
              Нет заказов, которые можно закрыть товаром с полки
            </p>
          )}

          <div className="space-y-1.5">
            <Label>Стикер хранения</Label>
            <Input
              autoFocus
              placeholder="Отсканируйте стикер хранения"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              className="font-mono-tech"
            />
          </div>

          {labeled.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-border p-3">
              <p className="text-sm font-medium">Готово к поставке: {labeled.length}</p>
              {labeled.map((l, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon name="Check" size={14} className="text-emerald-600" />
                  {l}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ShipLabelDialog;
