import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { packerReturnToRoll } from '@/lib/rollsApi';

interface KioskReturnToRollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Вещь, из-за перекроя которой остался кусок, — для следа в истории рулона. */
  goodsWarehouseId?: number;
}

/**
 * Возврат годного куска материала на рулон при перепаковке.
 *
 * Зачем. Иногда при перепаковке нужен перекрой, и на руках остаётся целый кусок
 * материала. Выбрасывать его жалко — упаковщица пикает рулон, указывает метраж,
 * и кусок возвращается в оборот.
 *
 * Этот метраж числится ОТДЕЛЬНО от основного метража рулона: расход по нему
 * виден сам по себе, а в расчёт штрафа за недостачу он не входит — иначе
 * закройщица получила бы удержание за материал, которого не брала.
 *
 * Экран сенсорный, поэтому всё крупное: цифры набираются кнопками, клавиатуру
 * на киоске не вызвать.
 */
const KioskReturnToRollDialog = ({
  open,
  onOpenChange,
  goodsWarehouseId,
}: KioskReturnToRollDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [barcode, setBarcode] = useState('');
  const [quantity, setQuantity] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Открыли окно — курсор сразу в поле сканера: упаковщица пикает рулон,
  // не касаясь экрана руками в перчатках.
  useEffect(() => {
    if (open) {
      setBarcode('');
      setQuantity('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const addDigit = (d: string) =>
    setQuantity((prev) => {
      if (d === '.' && prev.includes('.')) return prev;
      if (d === '.' && !prev) return '0.';
      return (prev + d).slice(0, 8);
    });

  const handleSave = async () => {
    const qty = Number(quantity.replace(',', '.'));
    if (!barcode.trim()) {
      toast({ title: 'Отсканируйте рулон', variant: 'destructive' });
      inputRef.current?.focus();
      return;
    }
    if (!qty || qty <= 0) {
      toast({ title: 'Укажите метраж больше нуля', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const res = await packerReturnToRoll({
        barcode: barcode.trim(),
        quantity: qty,
        goodsWarehouseId,
        userId: user?.id,
        userName: user?.name,
      });
      toast({
        title: `Вернули на рулон: ${res.added} ${res.unit || ''}`.trim(),
        description: `${res.materialName || res.barcode} · на рулоне стало ${res.remainingQuantity}`,
      });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: 'Не удалось вернуть материал',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onOpenChange(false)}>
      <DialogContent className="kiosk-root sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl">Вернуть материал на рулон</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-base font-medium">1. Отсканируйте рулон</p>
            <Input
              ref={inputRef}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Штрихкод рулона"
              className="h-16 font-mono-tech text-xl"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-base font-medium">2. Сколько метров возвращаете</p>
            <div className="flex h-16 items-center justify-center rounded-md border-2 border-violet-300 bg-violet-50 text-3xl font-bold">
              {quantity || '0'}
            </div>
            {/* Цифры кнопками: сенсорный киоск без клавиатуры. */}
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'].map((d) => (
                <Button
                  key={d}
                  type="button"
                  variant="outline"
                  className="h-14 text-2xl"
                  onClick={() => addDigit(d)}
                  disabled={saving}
                >
                  {d}
                </Button>
              ))}
              <Button
                type="button"
                variant="outline"
                className="h-14 text-2xl"
                onClick={() => setQuantity((p) => p.slice(0, -1))}
                disabled={saving}
              >
                <Icon name="Delete" size={24} />
              </Button>
            </div>
          </div>

          <p className="rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
            Кусок вернётся на рулон и будет числиться отдельно — как свободный
            остаток. На штрафы за недостачу он не влияет.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Button
              size="lg"
              className="h-20 bg-violet-600 text-xl text-white hover:bg-violet-700"
              onClick={handleSave}
              disabled={saving}
            >
              <Icon
                name={saving ? 'Loader2' : 'Check'}
                size={26}
                className={`mr-2 ${saving ? 'animate-spin' : ''}`}
              />
              Вернуть на рулон
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-20 text-xl"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Отмена
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default KioskReturnToRollDialog;
