import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import {
  scanPickupReturn,
  markPvzSubstitution,
  type PickupRoute,
} from '@/lib/marketplaceReturnsApi';
import { placeOnShelf } from '@/lib/goodsWarehouseApi';
import { playScanSound, playScanErrorSound, primeScanSounds } from '@/lib/scanSound';
import { fixScanLayout } from '@/lib/keyboardLayout';

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
  /** Кладовщик отметил подмену товара на пункте выдачи. */
  substituted?: boolean;
  /** Куда вещь дальше: в цех на проверку или на полку. */
  route?: PickupRoute | null;
  /** Полка, на которую вещь положили из этого окна. */
  shelfName?: string;
  error?: string;
}

/**
 * Приёмка возвратов, привезённых с пункта выдачи, — сканером.
 *
 * Кладовщик пикает наклейку на пакете, и вещь сразу встаёт на склад. Разбора
 * у кладовщика больше нет:
 *   - вещь, которая была у покупателя, сразу «На проверке» — её везут в цех
 *     к упаковщице;
 *   - вещь, которую отменили в день отгрузки (до покупателя не доехала),
 *     кладовщик кладёт на полку прямо здесь — кнопкой «Положить на полку»,
 *     система сама называет полку.
 *
 * Возвраты приезжают штучно: одна вещь — один пакет со своей наклейкой.
 * Фокус из поля не уходит даже после ошибки: пикать можно пачку подряд.
 */
const PickupReturnsDialog = ({ open, onOpenChange, onDone }: PickupReturnsDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [flagging, setFlagging] = useState<number | null>(null);
  const [placing, setPlacing] = useState<number | null>(null);
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
    const code = fixScanLayout(barcode.trim());
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
          route: res.route ?? null,
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

  const handleSubstitution = async (row: ScanRow) => {
    if (flagging != null) return;
    setFlagging(row.key);
    try {
      const res = await markPvzSubstitution(row.barcode, user?.id, user?.name);
      setRows((prev) =>
        prev.map((r) => (r.key === row.key ? { ...r, substituted: true } : r))
      );
      toast({
        title: res.already ? 'Подмена уже отмечена' : 'Подмена отмечена',
        description: 'Администратор получил уведомление на панель',
      });
    } catch (e) {
      toast({
        title: 'Не удалось отметить подмену',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setFlagging(null);
      focusInput();
    }
  };

  const handlePlace = async (row: ScanRow) => {
    if (placing != null || !row.storageBarcode) return;
    setPlacing(row.key);
    try {
      const res = await placeOnShelf(row.storageBarcode);
      playScanSound();
      setRows((prev) =>
        prev.map((r) => (r.key === row.key ? { ...r, shelfName: res.shelfName } : r))
      );
      onDone();
    } catch (e) {
      playScanErrorSound();
      toast({
        title: 'Не удалось положить на полку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPlacing(null);
      focusInput();
    }
  };

  useScannerAutoSubmit(barcode, handleScan, !busy && flagging == null && placing == null);

  const okCount = rows.filter((r) => r.ok && !r.already).length;
  const toCheck = rows.filter((r) => r.ok && r.route === 'check').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Привёз с пункта выдачи</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Сканируйте пакеты один за другим — OZON, Wildberries и Яндекс Маркет. Каждая
            вещь сразу уходит «На проверке» — отвезите её в цех. Если заказ отменили в
            день отгрузки и вещь не была у покупателя, здесь появится кнопка «Положить на
            полку». Не тот товар в пакете — нажмите «Подмена на ПВЗ».
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
              <p className="text-sm font-medium">
                Принято: {okCount}
                {toCheck > 0 && (
                  <span className="font-normal text-muted-foreground"> · в цех: {toCheck}</span>
                )}
              </p>
              <div className="max-h-72 space-y-2 overflow-y-auto">
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
                          <PickupRouteLine row={r} />
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {r.route === 'shelf' && !r.shelfName && r.storageBarcode && (
                              <Button
                                type="button"
                                size="sm"
                                className="h-8"
                                disabled={placing != null}
                                onClick={() => handlePlace(r)}
                              >
                                <Icon
                                  name={placing === r.key ? 'Loader2' : 'Archive'}
                                  size={14}
                                  className={`mr-1.5 ${placing === r.key ? 'animate-spin' : ''}`}
                                />
                                Положить на полку
                              </Button>
                            )}
                            {r.substituted ? (
                              <p className="text-xs font-medium text-amber-800">
                                Подмена отмечена · админ уведомлён
                              </p>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8"
                                disabled={flagging != null}
                                onClick={() => handleSubstitution(r)}
                              >
                                <Icon
                                  name={flagging === r.key ? 'Loader2' : 'ArrowLeftRight'}
                                  size={14}
                                  className={`mr-1.5 ${flagging === r.key ? 'animate-spin' : ''}`}
                                />
                                Подмена на ПВЗ
                              </Button>
                            )}
                          </div>
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

/** Куда идёт вещь после скана — одной строкой, цветом по действию. */
const PickupRouteLine = ({ row }: { row: ScanRow }) => {
  if (row.shelfName) {
    return (
      <p className="mt-1 text-xs font-semibold text-emerald-700">
        Положите на полку {row.shelfName}
      </p>
    );
  }
  if (row.route === 'shelf') {
    return (
      <p className="mt-1 text-xs font-semibold text-emerald-700">
        Не была у покупателя — на полку, без проверки
      </p>
    );
  }
  if (row.route === 'check') {
    return (
      <p className="mt-1 text-xs font-semibold text-amber-700">
        На проверке — отвезите в цех
      </p>
    );
  }
  return null;
};

export default PickupReturnsDialog;
