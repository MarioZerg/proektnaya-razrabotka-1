import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { sendGoodsToSewing, type GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';

interface SendToSewingDialogProps {
  item: GoodsWarehouseItem | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

const REASONS = ['Порвана', 'Пятно', 'Брак пошива', 'Не тот размер', 'Потеряла вид'];

/** Вещь с полки испорчена и отгружать её нельзя. Списываем вещь со склада, а заказ
 * возвращаем в производство — его сошьют заново, и он не зависнет на подборе. */
const SendToSewingDialog = ({ item, onOpenChange, onDone }: SendToSewingDialogProps) => {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSend = async () => {
    if (!item || !reason.trim()) return;
    setSaving(true);
    try {
      const res = await sendGoodsToSewing(item.id, reason.trim());
      toast({
        title: 'Вещь списана, заказ отправлен в пошив',
        description: res.returnedOrder
          ? `Заказ ${res.returnedOrder} вернулся в производство`
          : 'Вещь убрана со склада',
      });
      setReason('');
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось отправить в пошив',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={!!item}
      onOpenChange={(v) => {
        if (!v) setReason('');
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Отправить в пошив</DialogTitle>
        </DialogHeader>

        {item && (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p className="font-mono-tech">{item.storageBarcode}</p>
              <p className="mt-0.5">{item.product || '—'}</p>
              {item.reservedOrderNumber && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Подобрана под заказ {item.reservedOrderNumber}
                </p>
              )}
            </div>

            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <Icon name="TriangleAlert" size={18} className="mt-0.5 shrink-0" />
              <p>
                Вещь будет списана со склада, а заказ уйдёт в производство — его сошьют заново.
                Действие нельзя отменить.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Что с вещью не так?</Label>
              <div className="flex flex-wrap gap-1.5">
                {REASONS.map((r) => (
                  <Button
                    key={r}
                    type="button"
                    variant={reason === r ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setReason(r)}
                  >
                    {r}
                  </Button>
                ))}
              </div>
              <Textarea
                placeholder="Или опишите своими словами"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
            </div>

            <Button
              variant="destructive"
              className="w-full"
              disabled={saving || !reason.trim()}
              onClick={handleSend}
            >
              {saving ? (
                <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
              ) : (
                <Icon name="Scissors" size={16} className="mr-2" />
              )}
              Списать и отправить в пошив
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SendToSewingDialog;
