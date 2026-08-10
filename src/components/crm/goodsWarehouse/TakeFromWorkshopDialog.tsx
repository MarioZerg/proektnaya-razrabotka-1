import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { takeFromWorkshop } from '@/lib/goodsWarehouseApi';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';

interface TakeFromWorkshopDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/** Строка результата скана: забрали вещь или почему не смогли. */
interface ScanRow {
  key: number;
  ok: boolean;
  barcode: string;
  product?: string | null;
  orderNumber?: string | null;
  toDispose?: boolean;
  error?: string;
}

/**
 * Кладовщик забирает осмотренные вещи из цеха.
 *
 * Упаковщица наклеила стикер хранения — кладовщик пикает его и складывает вещь в тележку.
 * Утилизированные вещи он тоже забирает физически и несёт старшему кладовщику, поэтому
 * их сканирование разрешено, но статус утилизации сохраняется — мы предупреждаем об этом
 * прямо в строке.
 *
 * Фокус из поля не уходит даже после ошибки: пикать можно пачку подряд.
 */
const TakeFromWorkshopDialog = ({
  open,
  onOpenChange,
  onDone,
}: TakeFromWorkshopDialogProps) => {
  const { user } = useAuth();
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  useEffect(() => {
    if (open) {
      setRows([]);
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
      const res = await takeFromWorkshop(code, user?.id, user?.name);
      playScanSound();
      setRows((prev) =>
        [
          {
            key: Date.now(),
            ok: true,
            barcode: code,
            product: res.product,
            orderNumber: res.orderNumber,
            toDispose: res.toDispose,
          },
          ...prev,
        ].slice(0, 40)
      );
      onDone();
    } catch (e) {
      playScanErrorSound();
      setRows((prev) =>
        [
          {
            key: Date.now(),
            ok: false,
            barcode: code,
            error: e instanceof Error ? e.message : 'Не удалось забрать',
          },
          ...prev,
        ].slice(0, 40)
      );
    } finally {
      setBusy(false);
      focusInput();
    }
  };

  useScannerAutoSubmit(barcode, handleScan, !busy);

  const takenCount = rows.filter((r) => r.ok).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Забрать вещи из цеха</DialogTitle>
        </DialogHeader>

        <div
          className="space-y-4"
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('input, button, a')) focusInput();
          }}
        >
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-sm text-muted-foreground">
              Сканируйте стикеры хранения, которые наклеила упаковщица. Брак тоже
              забирайте — отнесёте его старшему кладовщику
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Стикер хранения</p>
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

          {rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Забрано: {takenCount}</p>
              <div className="max-h-72 space-y-1.5 overflow-y-auto">
                {rows.map((r) =>
                  r.ok ? (
                    <div
                      key={r.key}
                      className={`flex items-start gap-2 rounded-md border p-2.5 ${
                        r.toDispose
                          ? 'border-destructive/40 bg-destructive/5'
                          : 'border-emerald-300 bg-emerald-50'
                      }`}
                    >
                      <Icon
                        name={r.toDispose ? 'TriangleAlert' : 'CircleCheck'}
                        size={16}
                        className={`mt-0.5 shrink-0 ${
                          r.toDispose ? 'text-destructive' : 'text-emerald-600'
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{r.product || 'Товар'}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.orderNumber || '—'} · {r.barcode}
                        </p>
                        {r.toDispose && (
                          <p className="text-xs font-medium text-destructive">
                            Брак — отнесите старшему кладовщику
                          </p>
                        )}
                      </div>
                    </div>
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

export default TakeFromWorkshopDialog;
