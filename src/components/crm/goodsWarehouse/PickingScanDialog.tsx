import { useEffect, useRef, useState } from 'react';
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

/** Результат одного скана: что нашлось (или почему нет). */
interface ScanResult {
  key: number;
  ok: boolean;
  barcode: string;
  product?: string | null;
  shelfName?: string | null;
  orderNumber?: string | null;
  goodsId?: number;
  error?: string;
}

/**
 * Сканер подбора — поиск вещи по складу.
 *
 * Кладовщик собирает контейнер: пикает вещь за вещью и слышит сигнал. Верный товар —
 * короткий сигнал и строка с полкой, чужой — сигнал ошибки. Ничего не меняется в базе:
 * это именно поиск, стикеровка идёт отдельным шагом.
 *
 * Фокус НИКОГДА не уходит из поля — даже после ошибки. Кладовщик пикает пачку подряд,
 * не притрагиваясь к мышке: раньше после ошибки фокус слетал и следующий скан уходил
 * «в никуда».
 */
const PickingScanDialog = ({ open, onOpenChange, onOpenCard }: PickingScanDialogProps) => {
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ScanResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  useEffect(() => {
    if (open) {
      // Открытие окна — разрешённое браузером взаимодействие: греем звук заранее,
      // чтобы первый же скан прозвучал.
      primeScanSounds();
      setResults([]);
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
      playScanSound();
      setResults((prev) =>
        [
          {
            key: Date.now(),
            ok: true,
            barcode: code,
            product: item.product,
            shelfName: item.shelfName,
            orderNumber: item.reservedOrderNumber || item.orderNumber,
            goodsId: item.id,
          },
          ...prev,
        ].slice(0, 30)
      );
    } catch (e) {
      playScanErrorSound();
      setResults((prev) =>
        [
          {
            key: Date.now(),
            ok: false,
            barcode: code,
            error: e instanceof Error ? e.message : 'Товар не найден',
          },
          ...prev,
        ].slice(0, 30)
      );
    } finally {
      setBusy(false);
      // Возвращаем фокус в любом случае: и после успеха, и после ошибки.
      focusInput();
    }
  };

  useScannerAutoSubmit(barcode, handleScan, !busy);

  const foundCount = results.filter((r) => r.ok).length;

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
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-sm text-muted-foreground">
              Пикайте вещи подряд — сигнал подскажет, ваш это товар или нет. Ничего
              не меняется: это поиск по складу, чтобы собрать контейнер
            </p>
          </div>

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

          {results.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Отсканировано: {results.length} · найдено {foundCount}
              </p>
              <div className="max-h-72 space-y-1.5 overflow-y-auto">
                {results.map((r) =>
                  r.ok ? (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => r.goodsId && onOpenCard(r.goodsId)}
                      className="flex w-full items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-2.5 text-left hover:bg-emerald-100"
                    >
                      <Icon
                        name="CircleCheck"
                        size={16}
                        className="mt-0.5 shrink-0 text-emerald-600"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-emerald-900">
                          {r.product || 'Товар'}
                        </p>
                        <p className="text-xs text-emerald-900">
                          Полка {r.shelfName || '—'} · {r.barcode}
                        </p>
                        {r.orderNumber && (
                          <p className="text-xs text-emerald-900">Заказ {r.orderNumber}</p>
                        )}
                      </div>
                      <Icon name="ChevronRight" size={16} className="mt-0.5 text-emerald-600" />
                    </button>
                  ) : (
                    <div
                      key={r.key}
                      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5"
                    >
                      <Icon
                        name="CircleAlert"
                        size={16}
                        className="mt-0.5 shrink-0 text-destructive"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{r.barcode}</p>
                        <p className="text-xs text-muted-foreground">{r.error}</p>
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PickingScanDialog;
