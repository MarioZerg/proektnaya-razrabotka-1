import { useEffect, useRef, useState } from 'react';
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
import type { Shelf } from '@/lib/shelvesApi';
import { useAuth } from '@/context/AuthContext';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { fetchGoodsByBarcode, moveGoodsShelfBatch } from '@/lib/goodsWarehouseApi';
import { playScanSound, playScanErrorSound, primeScanSounds } from '@/lib/scanSound';
interface MoveShelfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shelves: Shelf[];
  onDone: () => void;
}
/** Вещь, набранная в буфер до нажатия «Перенести». */
interface BufferItem {
  barcode: string;
  product: string | null;
}
/**
 * Смена полки — набрал пачку и перенёс.
 *
 * Кладовщик стоит у стеллажа: слева выбирает полку-источник (можно не выбирать),
 * справа — куда кладём, между ними стрелка. Дальше просто пикает вещи: они копятся
 * в буфере, на экране только счётчик и последняя вещь. Нажал «Перенести» — вся пачка
 * уехала на новую полку одним действием.
 *
 * Списка-портянки здесь нет намеренно: за минуту работы он перекрывал экран, и в нём
 * терялось главное — сколько вещей набрано и куда они поедут.
 */
const MoveShelfDialog = ({
  open,
  onOpenChange,
  shelves,
  onDone,
}: MoveShelfDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  /** Откуда переносим — только подсказка кладовщику, вещи ищутся по стикеру. */
  const [fromShelfId, setFromShelfId] = useState('');
  const [toShelfId, setToShelfId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [buffer, setBuffer] = useState<BufferItem[]>([]);
  /** Последняя вещь и последняя ошибка — единственное, что занимает экран. */
  const [lastOk, setLastOk] = useState<BufferItem | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  /** Сколько сканов ушло мимо: бронь, чужие, не найдены. */
  const [skipped, setSkipped] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);
  const resetAll = () => {
    setBuffer([]);
    setLastOk(null);
    setLastError(null);
    setSkipped(0);
    setBarcode('');
  };
  useEffect(() => {
    if (open) {
      primeScanSounds();
      resetAll();
      setFromShelfId('');
      setToShelfId('');
    }
  }, [open]);
  useEffect(() => {
    if (toShelfId) focusInput();
  }, [toShelfId]);
  const toShelfName = shelves.find((s) => String(s.id) === toShelfId)?.name || '';
  const handleScan = async () => {
    const code = barcode.trim();
    if (!code || !toShelfId) return;
    setBarcode('');
    setBusy(true);
    setLastError(null);
    try {
      const item = await fetchGoodsByBarcode(code);
      // Бронь под заказ FBS не двигаем: за вещью уже идёт сборщик по конкретной полке.
      if (item.reservedOrderId) {
        playScanErrorSound();
        setSkipped((n) => n + 1);
        setLastError(
          `${item.product || 'Товар'} забронирован под заказ ${
            item.reservedOrderNumber || ''
          } — его нужно собрать и отправить`.trim()
        );
        return;
      }
      if (['picking', 'awaiting_supply', 'reserved', 'shipped'].includes(item.status)) {
        playScanErrorSound();
        setSkipped((n) => n + 1);
        setLastError(`${item.product || 'Товар'} уже собран для отправки`);
        return;
      }
      // Повторный скан той же вещи не должен раздувать счётчик.
      if (buffer.some((b) => b.barcode === code)) {
        playScanErrorSound();
        setLastError('Эта вещь уже в пачке');
        return;
      }
      playScanSound();
      const row = { barcode: code, product: item.product };
      setBuffer((prev) => [...prev, row]);
      setLastOk(row);
    } catch (e) {
      playScanErrorSound();
      setSkipped((n) => n + 1);
      setLastError(e instanceof Error ? e.message : 'Вещь не найдена');
    } finally {
      setBusy(false);
      focusInput();
    }
  };
  useScannerAutoSubmit(barcode, handleScan, !!toShelfId && !busy);
  const handleMove = async () => {
    if (!buffer.length || !toShelfId) return;
    setSaving(true);
    try {
      const res = await moveGoodsShelfBatch(
        buffer.map((b) => b.barcode),
        Number(toShelfId),
        user?.id,
        user?.name
      );
      playScanSound();
      toast({
        title: 'Перенесено',
        description: `На полку ${res.shelfName || toShelfName} уехало вещей: ${res.moved}`,
      });
      resetAll();
      onDone();
      focusInput();
    } catch (e) {
      playScanErrorSound();
      toast({
        title: 'Не удалось перенести',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    // Кнопку окно больше не рисует само: все действия склада собраны в одной панели
    // наверху страницы, иначе они разъезжались по экрану в случайном порядке.
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Смена полки</DialogTitle>
        </DialogHeader>
        <div
          className="space-y-4"
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('input, button, a, [role="combobox"]')) {
              focusInput();
            }
          }}
        >
          {/* Откуда → куда: стрелка посередине, как на схеме стеллажа. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
            <div className="space-y-1.5">
              <Label>Откуда (необязательно)</Label>
              <Select value={fromShelfId} onValueChange={setFromShelfId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Любая полка" />
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
            <div className="pb-2.5">
              <Icon name="ArrowRight" size={28} className="text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label>Куда кладём</Label>
              <Select value={toShelfId} onValueChange={setToShelfId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Выберите полку" />
                </SelectTrigger>
                <SelectContent>
                  {shelves
                    .filter((s) => String(s.id) !== fromShelfId)
                    .map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {toShelfId ? (
            <div className="space-y-1.5">
              <Label>Сканируйте вещи для полки «{toShelfName}»</Label>
              <Input
                ref={inputRef}
                autoFocus
                placeholder="Наведите сканер на стикер хранения"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                onBlur={focusInput}
                className="h-12 font-mono-tech text-lg"
                autoComplete="off"
              />
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border p-4 text-center">
              <p className="text-sm text-muted-foreground">
                Выберите полку справа — и сканируйте вещи одну за другой
              </p>
            </div>
          )}
          {/* Кубики вместо списка: набрано и мимо. Видно с расстояния. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
              <p className="text-3xl font-bold text-emerald-700">{buffer.length}</p>
              <p className="text-sm text-emerald-900">В пачке на перенос</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-3xl font-bold text-muted-foreground">{skipped}</p>
              <p className="text-sm text-muted-foreground">Мимо (нельзя двигать)</p>
            </div>
          </div>
          {/* Только последняя вещь и последняя ошибка — без портянки. */}
          {lastError ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <Icon name="CircleAlert" size={18} className="mt-0.5 shrink-0 text-destructive" />
              <p className="text-sm">{lastError}</p>
            </div>
          ) : lastOk ? (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
              <Icon name="CircleCheck" size={18} className="mt-0.5 shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <p className="text-base font-semibold text-emerald-900">
                  {lastOk.product || 'Товар'}
                </p>
                <p className="text-xs text-emerald-900">{lastOk.barcode}</p>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              onClick={handleMove}
              disabled={saving || !buffer.length || !toShelfId}
            >
              <Icon
                name={saving ? 'Loader2' : 'ArrowRight'}
                size={18}
                className={`mr-2 ${saving ? 'animate-spin' : ''}`}
              />
              Перенести {buffer.length > 0 ? `(${buffer.length})` : ''}
            </Button>
            {buffer.length > 0 && (
              <Button
                size="lg"
                variant="ghost"
                onClick={() => {
                  resetAll();
                  focusInput();
                }}
              >
                Сбросить пачку
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
export default MoveShelfDialog;