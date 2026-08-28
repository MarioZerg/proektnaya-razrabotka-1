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
import { packerReturnToRoll, fetchSuitableRolls } from '@/lib/rollsApi';

interface KioskReturnToRollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Вещь, из-за перекроя которой остался кусок, — для следа в истории рулона. */
  goodsWarehouseId?: number;
}

interface SuitableRoll {
  id: number;
  barcode: string;
  materialName: string | null;
  remainingQuantity: number;
  unit: string | null;
}

/**
 * Возврат годного куска материала на рулон при перепаковке.
 *
 * Зачем. Иногда при перепаковке нужен перекрой, и на руках остаётся целый кусок
 * материала. Выбрасывать его жалко — упаковщица кладёт его на рулон, и кусок
 * возвращается в оборот свободным остатком.
 *
 * МЕТРАЖ НЕ ВВОДИТСЯ РУКАМИ. Раньше упаковщица набирала его на сенсорной
 * клавиатуре — лишний шаг и источник ошибок: промахнулась цифрой, и на рулоне
 * появились метры, которых нет. Теперь метраж считается сам: полотно кроят
 * поперёк рулона, поэтому кусок шириной 200 см — это ровно 2 погонных метра.
 *
 * РУЛОН ТОЛЬКО ПОДХОДЯЩИЙ. Показываем лишь рулоны того же материала, из её цеха
 * и её смены: вуаль нельзя прицепить к сетке, а чужие метры разошлись бы с
 * остатком другой бригады на закрытии смены.
 *
 * Этот метраж числится ОТДЕЛЬНО от основного метража рулона: в расчёт штрафа за
 * недостачу он не входит — иначе закройщица получила бы удержание за материал,
 * которого не брала.
 */
const KioskReturnToRollDialog = ({
  open,
  onOpenChange,
  goodsWarehouseId,
}: KioskReturnToRollDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [barcode, setBarcode] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rolls, setRolls] = useState<SuitableRoll[]>([]);
  const [material, setMaterial] = useState<string | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [quantity, setQuantity] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Открыли окно — сразу спрашиваем, какие рулоны подходят, и ставим курсор
  // в поле сканера: упаковщица пикает рулон, не касаясь экрана в перчатках.
  useEffect(() => {
    if (!open) return;
    setBarcode('');
    setRolls([]);
    setTimeout(() => inputRef.current?.focus(), 100);

    if (!goodsWarehouseId) return;
    setLoading(true);
    fetchSuitableRolls({ goodsWarehouseId, userId: user?.id })
      .then((d) => {
        setRolls(d.rolls || []);
        setMaterial(d.material);
        setWidth(d.width);
        setQuantity(d.quantity);
      })
      .catch(() => setRolls([]))
      .finally(() => setLoading(false));
  }, [open, goodsWarehouseId, user?.id]);

  const save = async (code: string) => {
    if (!code.trim()) {
      toast({ title: 'Отсканируйте рулон', variant: 'destructive' });
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      // Метраж не передаём: сервер посчитает его сам по ширине вещи.
      const res = await packerReturnToRoll({
        barcode: code.trim(),
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
          {/* Что именно вернётся — видно сразу, без подсчётов в уме. */}
          <div className="rounded-md border-2 border-violet-300 bg-violet-50 p-4">
            <div className="text-sm text-violet-900">Вернётся на рулон</div>
            <div className="mt-1 text-3xl font-bold text-violet-900">
              {quantity != null ? `${quantity} м` : '—'}
            </div>
            <div className="mt-1 text-sm text-violet-800">
              {material || 'материал не указан'}
              {width ? ` · ширина вещи ${width} см` : ''}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-base font-medium">Отсканируйте рулон</p>
            <Input
              ref={inputRef}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => {
                // Сканер сам жмёт Enter — сохраняем без лишнего касания экрана.
                if (e.key === 'Enter' && barcode.trim() && !saving) save(barcode);
              }}
              placeholder="Штрихкод рулона"
              className="h-16 font-mono-tech text-xl"
              autoComplete="off"
              disabled={saving}
            />
          </div>

          {/* Подходящие рулоны — чтобы не гадать и не бегать проверять.
              Нажатие работает как скан: на киоске это быстрее. */}
          <div className="space-y-1.5">
            <p className="text-base font-medium">
              Подходящие рулоны{rolls.length > 0 ? ` (${rolls.length})` : ''}
            </p>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon name="Loader2" size={18} className="animate-spin" />
                Ищем рулоны вашей смены...
              </div>
            ) : rolls.length === 0 ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                В вашем цехе и смене нет открытых рулонов
                {material ? ` из «${material}»` : ''}. Спросите закройщицу — кусок
                можно вернуть только на рулон того же материала.
              </p>
            ) : (
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {rolls.map((r) => (
                  <Button
                    key={r.id}
                    type="button"
                    variant="outline"
                    className="h-auto w-full justify-between px-4 py-3 text-left"
                    onClick={() => save(r.barcode)}
                    disabled={saving}
                  >
                    <span>
                      <span className="block font-mono-tech text-base">{r.barcode}</span>
                      <span className="block text-sm text-muted-foreground">
                        {r.materialName || '—'}
                      </span>
                    </span>
                    <span className="whitespace-nowrap text-sm text-muted-foreground">
                      осталось {r.remainingQuantity} {r.unit || ''}
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </div>

          <p className="rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
            Кусок вернётся на рулон и будет числиться отдельно — как свободный
            остаток. На штрафы за недостачу он не влияет.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Button
              size="lg"
              className="h-20 bg-violet-600 text-xl text-white hover:bg-violet-700"
              onClick={() => save(barcode)}
              disabled={saving || !barcode.trim()}
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
