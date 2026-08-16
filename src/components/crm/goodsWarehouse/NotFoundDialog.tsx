import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { markGoodsNotFound } from '@/lib/goodsWarehouseApi';

export interface NotFoundTarget {
  id: number;
  title: string;
  orderNumber?: string | null;
  storageBarcode?: string | null;
  shelfName?: string | null;
}

interface NotFoundDialogProps {
  item: NotFoundTarget | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/**
 * «Не нашёл» — товара нет на полке, хотя система считает, что он там лежит.
 *
 * Раньше это был тупик: кладовщик сканировал сотни вещей, нужную не находил и уходил —
 * а назавтра автоподбор предлагал её снова. Вещи висели в подборе неделями (были и
 * такие, что искали больше месяца), а заказы покупателей всё это время стояли.
 *
 * Теперь вещь списывается со склада, а заказ сразу уходит в цех — его сошьют заново.
 * Решение платное (ткань + повторная работа цеха), поэтому доступно только старшему
 * кладовщику и админу, и о каждом случае админ узнаёт на панели.
 */
const NotFoundDialog = ({ item, onOpenChange, onDone }: NotFoundDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const handleConfirm = async () => {
    if (!item) return;
    setSaving(true);
    try {
      const res = await markGoodsNotFound(item.id, note.trim(), user?.id, user?.name);
      toast({
        title: 'Товар списан со склада',
        description: res.returnedOrder
          ? `Заказ ${res.returnedOrder} отправлен в цех на пошив`
          : 'Вещь убрана из подбора',
      });
      setNote('');
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось списать товар',
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
        if (!v) setNote('');
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Товар не найден на складе</DialogTitle>
        </DialogHeader>

        {item && (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <div className="font-medium">{item.title}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {item.orderNumber || '—'}
                {item.storageBarcode ? ` · ${item.storageBarcode}` : ''}
                {item.shelfName ? ` · полка «${item.shelfName}»` : ''}
              </div>
            </div>

            {/* Честно предупреждаем о цене решения: вещь уходит из остатков, а цех
                шьёт заново. Кладовщик должен нажать кнопку осознанно, а не на автомате. */}
            <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <Icon name="TriangleAlert" size={18} className="mt-0.5 shrink-0" />
              <div>
                Вещь будет списана со склада, а заказ уйдёт в цех — его сошьют заново.
                Администратор получит уведомление.
                <div className="mt-1 font-medium">
                  Сначала проверьте соседние полки и запасные варианты.
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nf-note">Комментарий (необязательно)</Label>
              <Textarea
                id="nf-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Например: обыскал все полки, вещи нет"
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                Отмена
              </Button>
              <Button variant="destructive" onClick={handleConfirm} disabled={saving}>
                {saving ? (
                  <Icon name="Loader2" size={16} className="mr-1.5 animate-spin" />
                ) : (
                  <Icon name="SearchX" size={16} className="mr-1.5" />
                )}
                Списать и отправить в пошив
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default NotFoundDialog;
