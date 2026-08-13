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
  product?: string | null;
  shelfName?: string | null;
  orderNumber?: string | null;
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
  /**
   * Штрихкоды, уже посчитанные в этой сессии.
   *
   * Вещь физически одна, поэтому и считаться она должна один раз. Сканер часто
   * срабатывает дважды по одной наклейке (рука дрогнула, повторный пик по той же
   * коробке) — раньше счётчик накручивался, и кладовщик думал, что собрал больше
   * вещей, чем лежит в контейнере.
   */
  const scannedRef = useRef<Set<string>>(new Set());
  /** Повторно отсканированный код — показываем предупреждение, но НЕ считаем. */
  const [duplicate, setDuplicate] = useState<string | null>(null);
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
      setDuplicate(null);
      scannedRef.current.clear();
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  const handleScan = async () => {
    const code = barcode.trim();
    if (!code) return;
    setBarcode('');

    // Эту наклейку уже пикали — вещь одна, второй раз её не считаем ни в нужные,
    // ни в «мимо». Просто предупреждаем, чтобы кладовщик не искал её снова.
    if (scannedRef.current.has(code.toUpperCase())) {
      playScanErrorSound();
      setDuplicate(code);
      focusInput();
      return;
    }

    setBusy(true);
    setDuplicate(null);
    try {
      const item: GoodsWarehouseItem = await fetchGoodsByBarcode(code);
      scannedRef.current.add(code.toUpperCase());
      // Нужная вещь — ровно та, что сейчас лежит в складском подборе. Одного резерва
      // мало: под условие попадали вещи, которые кладовщику брать не нужно —
      //   * заказ уже забрали в цех: кроят или шьют, отправление закроет вещь
      //     с конвейера, а эта останется на складе;
      //   * стикер отправления уже наклеен: вещь собрана и ждёт короб;
      //   * вещь уже уехала в поставку или отгружена — её физически нет на полке.
      // Всё это для сканера подбора — «мимо»: за такой вещью на склад не приходили.
      const inPicking =
        !!item.reservedOrderId &&
        !item.orderInProduction &&
        !item.shippingLabeledAt &&
        (item.status === 'in_stock' || item.status === 'picking');

      if (inPicking) {
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
      // Запоминаем и её: повторный пик по той же наклейке не должен накручивать «мимо».
      scannedRef.current.add(code.toUpperCase());
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
            <p className="text-sm font-medium">Сканируйте пакет с товаром</p>
            <Input
              ref={inputRef}
              autoFocus
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScan()}
              onBlur={focusInput}
              placeholder="Сканируйте пакет с товаром"
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

          {/* Повтор: вещь уже пикали, счётчики не тронуты. */}
          {duplicate && (
            <div className="flex items-center gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
              <Icon name="TriangleAlert" size={22} className="shrink-0 text-amber-600" />
              <div className="min-w-0">
                <p className="font-semibold text-amber-900">Эту вещь уже сканировали</p>
                <p className="text-sm text-amber-900">
                  {duplicate} — повтор не засчитан, ищите следующую
                </p>
              </div>
            </div>
          )}

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