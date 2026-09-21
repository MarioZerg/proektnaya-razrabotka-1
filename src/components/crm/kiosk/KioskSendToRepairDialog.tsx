import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { sendToRepair } from '@/lib/repairFabricApi';

interface KioskSendToRepairDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Вещь, которая уходит в перешив. */
  goodsWarehouseId?: number;
  /** Что за вещь — показываем упаковщице, чтобы она сверила перед отправкой. */
  material?: string | null;
  width?: number | null;
  height?: number | null;
  /** Вещь ушла в материал — экран перепаковки должен её отпустить. */
  onSent?: () => void;
}

/**
 * Отправка годного куска в перешив.
 *
 * ПОЧЕМУ БОЛЬШЕ НЕ НУЖЕН РУЛОН. Раньше упаковщица искала подходящий рулон,
 * сканировала его, и кусок растворялся в метраже: рулон просто прибавлял себе
 * несколько метров. Кусок терял размеры и переставал существовать как вещь —
 * закройщик видел обезличенные метры и не мог найти нужный отрез.
 *
 * Теперь упаковщица ничего не выбирает: одно нажатие, и кусок уходит в цех
 * СО СВОИМИ РАЗМЕРАМИ. Закройщик увидит его в списке под конкретный заказ —
 * система сама покажет только те куски, которые не меньше нужного размера.
 *
 * Размеры берутся из заказа, руками ничего не вводится: промахнуться цифрой
 * и создать кусок, которого нет, невозможно.
 */
const KioskSendToRepairDialog = ({
  open,
  onOpenChange,
  goodsWarehouseId,
  material,
  width,
  height,
  onSent,
}: KioskSendToRepairDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);

  const handleSend = async () => {
    if (!goodsWarehouseId) return;
    setSaving(true);
    try {
      const r = await sendToRepair(goodsWarehouseId, { id: user?.id, name: user?.name });
      toast({
        title: 'Отправлено в перешив',
        description: `${r.material} ${r.width}×${r.height} — закройщики увидят этот кусок`,
      });
      onOpenChange(false);
      onSent?.();
    } catch (e) {
      toast({
        title: 'Не удалось отправить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="kiosk-root sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl">Отправить в перешив?</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Показываем размеры крупно: упаковщица сверяет их с куском в руках
              до отправки, а не после. */}
          <div className="rounded-xl border-2 border-violet-300 bg-violet-50 p-4 text-center">
            <p className="text-lg text-violet-900">{material || 'Материал не указан'}</p>
            <p className="text-4xl font-bold text-violet-900">
              {width && height ? `${width} × ${height}` : '—'}
            </p>
            <p className="mt-1 text-base text-violet-800">сантиметров</p>
          </div>

          <p className="text-lg text-muted-foreground">
            Кусок уйдёт закройщикам в цех. Они увидят его под заказы, для которых
            он подходит по размеру. Рулон указывать не нужно
          </p>

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="h-16 flex-1 text-lg"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Отмена
            </Button>
            <Button
              className="h-16 flex-1 bg-violet-600 text-lg text-white hover:bg-violet-700"
              onClick={handleSend}
              disabled={saving || !goodsWarehouseId}
            >
              <Icon
                name={saving ? 'Loader2' : 'Scissors'}
                size={20}
                className={`mr-2 ${saving ? 'animate-spin' : ''}`}
              />
              {saving ? 'Отправляем…' : 'В перешив'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default KioskSendToRepairDialog;
