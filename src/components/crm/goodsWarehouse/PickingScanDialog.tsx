import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { fetchGoodsByBarcode, type GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { playScanSound, playScanErrorSound, primeScanSounds } from '@/lib/scanSound';

interface PickingScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Открыть карточку найденной вещи. */
  onOpenCard: (id: number) => void;
}

/** Найденная вещь, которую нужно забрать с полки. */
interface Hit {
  goodsId: number;
  barcode: string;
  product: string | null;
  shelfName: string | null;
  orderNumber: string | null;
}

/**
 * Сканер подбора — поиск нужных вещей на складе.
 *
 * Кладовщик идёт вдоль стеллажа и пикает всё подряд. Подавляющее большинство вещей —
 * не его: они просто лежат на складе и в текущий контейнер не идут. Показывать их
 * списком бессмысленно — за минуту работы экран превращался в портянку, в которой
 * терялась единственная важная строка.
 *
 * Поэтому: неликвид только считаем и озвучиваем сигналом ошибки, а на экране крупно
 * держим ТОЛЬКО нужную вещь — что это, с какой полки её взять и под какой заказ.
 *
 * Фокус из поля не уходит никогда, чтобы кладовщик пикал не притрагиваясь к мышке.
 */
const PickingScanDialog = ({ open, onOpenChange, onOpenCard }: PickingScanDialogProps) => {
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  /** Последняя нужная вещь — единственное, что занимает экран. */
  const [hit, setHit] = useState<Hit | null>(null);
  /** Сколько вещей отсканировано мимо: чужие, не подобранные, не найденные. */
  const [skipped, setSkipped] = useState(0);
  /** Сколько нужных найдено за сессию — прогресс сборки контейнера. */
  const [foundCount, setFoundCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  useEffect(() => {
    if (open) {
      // Открытие окна — разрешённое браузером взаимодействие: греем звук заранее,
      // чтобы первый же скан прозвучал.
      primeScanSounds();
      setHit(null);
      setSkipped(0);
      setFoundCount(0);
      setBarcode('');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  const handleScan = async () => {
    const code = barcode.trim();
    if (!code) return;
    setBarcode('');
    setBusy(true);
    try {
      const item: GoodsWarehouseItem = await fetchGoodsByBarcode(code);
      // Нужная вещь — та, что подобрана под заказ. Всё остальное лежит на складе
      // «просто так» и в текущий контейнер не идёт.
      if (item.reservedOrderId) {
        playScanSound();
        setHit({
          goodsId: item.id,
          barcode: code,
          product: item.product,
          shelfName: item.shelfName,
          orderNumber: item.reservedOrderNumber || item.orderNumber,
        });
        setFoundCount((n) => n + 1);
      } else {
        playScanErrorSound();
        setSkipped((n) => n + 1);
      }
    } catch {
      // Вещь не найдена или недоступна — для кладовщика это тот же неликвид.
      playScanErrorSound();
      setSkipped((n) => n + 1);
    } finally {
      setBusy(false);
      focusInput();
    }
  };

  useScannerAutoSubmit(barcode, handleScan, !busy);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Сканер подбора</DialogTitle>
        </DialogHeader>

        <div
          className="space-y-4"
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('input, button, a')) focusInput();
          }}
        >
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Отсканируйте стикер на вещи</p>
            <Input
              ref={inputRef}
              autoFocus
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScan()}
              onBlur={focusInput}
              placeholder="Наведите сканер на штрихкод"
              className="h-12 font-mono-tech text-lg"
              autoComplete="off"
            />
          </div>

          {/* Два счётчика вместо списка: нужное и мимо. Видно с расстояния. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
              <p className="text-3xl font-bold text-emerald-700">{foundCount}</p>
              <p className="text-sm text-emerald-900">Нужных найдено</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-3xl font-bold text-muted-foreground">{skipped}</p>
              <p className="text-sm text-muted-foreground">Мимо (не в подбор)</p>
            </div>
          </div>

          {/* Единственная строка, ради которой кладовщик смотрит на экран. */}
          {hit ? (
            <button
              type="button"
              onClick={() => onOpenCard(hit.goodsId)}
              className="flex w-full items-start gap-3 rounded-lg border-2 border-emerald-400 bg-emerald-50 p-4 text-left hover:bg-emerald-100"
            >
              <Icon
                name="PackageCheck"
                size={24}
                className="mt-0.5 shrink-0 text-emerald-600"
              />
              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold text-emerald-900">
                  {hit.product || 'Товар'}
                </p>
                <p className="text-base font-semibold text-emerald-900">
                  Полка {hit.shelfName || '—'}
                </p>
                <p className="text-sm text-emerald-900">
                  Заказ {hit.orderNumber || '—'} · {hit.barcode}
                </p>
              </div>
              <Icon name="ChevronRight" size={20} className="mt-1 text-emerald-600" />
            </button>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-4 text-center">
              <p className="text-sm text-muted-foreground">
                Пикайте вещи подряд. Здесь появится та, которую нужно забрать
              </p>
            </div>
          )}

          {hit && (
            <Button variant="ghost" size="sm" onClick={() => { setHit(null); focusInput(); }}>
              Убрать с экрана
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PickingScanDialog;
