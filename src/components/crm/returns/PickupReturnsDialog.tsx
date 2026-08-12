import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { scanPickupReturn } from '@/lib/marketplaceReturnsApi';
import { playScanSound, playScanErrorSound, primeScanSounds } from '@/lib/scanSound';

interface PickupReturnsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/** Строка результата: приняли вещь или почему не смогли. */
interface ScanRow {
  key: number;
  ok: boolean;
  barcode: string;
  title?: string;
  storageBarcode?: string | null;
  /** Эту вещь уже принимали — повторный скан не считается. */
  already?: boolean;
  error?: string;
}

/**
 * Приёмка возвратов, привезённых с пункта выдачи, — сканером.
 *
 * Кладовщик пикает наклейку на пакете, и вещь сразу встаёт на склад. Выбирать
 * галочками из списка не нужно: раньше он держал пакет в руках и всё равно искал
 * его в перечне из полусотни позиций — долго и легко отметить не ту вещь.
 *
 * Возвраты приезжают штучно: одна вещь — один пакет со своей наклейкой. Коробками
 * ездят только поставки на склад маркетплейса, здесь их нет.
 *
 * Возврат ищется у самого маркетплейса, поэтому принимается любой пакет — даже тот,
 * которого ещё не было в нашем списке.
 *
 * Фокус из поля не уходит даже после ошибки: пикать можно пачку подряд.
 */
const PickupReturnsDialog = ({ open, onOpenChange, onDone }: PickupReturnsDialogProps) => {
  const { user } = useAuth();
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  useEffect(() => {
    if (open) {
      // Открытие окна — разрешённое браузером взаимодействие: греем звук заранее,
      // чтобы первый же скан прозвучал.
      primeScanSounds();
      setRows([]);
      setBarcode('');
      focusInput();
    }
  }, [open]);

  const handleScan = async () => {
    const code = barcode.trim();
    if (!code || busy) return;
    setBusy(true);
    setBarcode('');
    try {
      const res = await scanPickupReturn(code, user?.id, user?.name);
      const a = res.accepted;
      const title =
        a && a.material && a.width && a.height
          ? `${a.material} ${a.width}×${a.height}`
          : a?.productName || 'Возврат принят';
      // Повторный скан той же вещи — не ошибка, но и не приёмка: сообщаем об этом
      // отдельным сигналом и не прибавляем к счётчику, иначе число принятого врёт.
      if (res.alreadyPicked) playScanErrorSound();
      else playScanSound();
      setRows((prev) => [
        {
          key: Date.now(),
          ok: true,
          barcode: code,
          title,
          storageBarcode: a?.storageBarcode,
          already: res.alreadyPicked,
        },
        ...prev,
      ]);
      onDone();
    } catch (e) {
      playScanErrorSound();
      setRows((prev) => [
        {
          key: Date.now(),
          ok: false,
          barcode: code,
          error: e instanceof Error ? e.message : 'Не удалось принять',
        },
        ...prev,
      ]);
    } finally {
      setBusy(false);
      focusInput();
    }
  };

  useScannerAutoSubmit(barcode, handleScan, !busy);

  const okCount = rows.filter((r) => r.ok && !r.already).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Привёз с пункта выдачи</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Сканируйте пакеты с товаром один за другим. Каждая вещь сразу встаёт
            на склад — дальше разберёте: в цех на осмотр или на полку.
          </p>

          <div className="space-y-1.5">
            <Label>Штрихкод возврата</Label>
            <Input
              ref={inputRef}
              autoFocus
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScan()}
              placeholder={busy ? 'Принимаем...' : 'Сканируйте пакет с товаром'}
              className="h-12 font-mono-tech text-lg"
              autoComplete="off"
            />
          </div>

          {rows.length > 0 && (
            <div className="space-y-1.5 rounded-md border border-border p-3">
              <p className="text-sm font-medium">Принято: {okCount}</p>
              <div className="max-h-64 space-y-1.5 overflow-y-auto">
                {rows.map((r) => (
                  <div key={r.key} className="flex items-start gap-2 text-sm">
                    <Icon
                      name={!r.ok ? 'X' : r.already ? 'Info' : 'Check'}
                      size={15}
                      className={`mt-0.5 shrink-0 ${
                        !r.ok
                          ? 'text-destructive'
                          : r.already
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      {r.ok ? (
                        <>
                          <p className="font-medium leading-tight">{r.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {r.already ? 'Уже принята ранее · ' : ''}
                            {r.storageBarcode || r.barcode}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="leading-tight text-destructive">{r.error}</p>
                          <p className="font-mono-tech text-xs text-muted-foreground">
                            {r.barcode}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PickupReturnsDialog;