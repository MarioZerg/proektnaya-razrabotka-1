import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { scanReturn, sendReturnToCheck, type ScannedReturn } from '@/lib/goodsWarehouseApi';
import { playScanSound, playScanErrorSound, primeScanSounds } from '@/lib/scanSound';

interface ReceiveReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCreate: () => void;
  onDone: () => void;
}

const formatDate = (value: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Строка «свойство — значение» в карточке возврата. */
const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between gap-3 border-b border-border py-1.5 last:border-0">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-right text-xs font-medium">{value || '—'}</span>
  </div>
);

/**
 * Приём возвратов с маркетплейса по ярлыку FBS.
 *
 * Кладовщик сканирует ярлык на приехавшей вещи. Система сама проверяет, могла ли эта
 * вещь физически вернуться: если заказ ещё «ожидает сборки» или «доставляется» —
 * принимать нечего, и мы прямо об этом говорим. Иначе показываем карточку: что за
 * товар, кто его кроил, шил и упаковывал, и почему покупатель отказался.
 *
 * Фокус из поля не уходит даже после ошибки — кладовщик пикает пачку возвратов подряд.
 */
const ReceiveReturnDialog = ({
  open,
  onOpenChange,
  onOpenCreate,
  onDone,
}: ReceiveReturnDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<ScannedReturn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  useEffect(() => {
    if (open) {
      // Открытие окна — разрешённое браузером взаимодействие: греем звук заранее,
      // чтобы первый же скан прозвучал.
      primeScanSounds();
      setFound(null);
      setError(null);
      setBarcode('');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [open]);

  const handleScan = async () => {
    const code = barcode.trim();
    if (!code) return;
    setBarcode('');
    setBusy(true);
    setError(null);
    try {
      const res = await scanReturn(code);
      playScanSound();
      setFound(res);
    } catch (e) {
      playScanErrorSound();
      setFound(null);
      setError(e instanceof Error ? e.message : 'Не удалось принять возврат');
      focusInput();
    } finally {
      setBusy(false);
    }
  };

  useScannerAutoSubmit(barcode, handleScan, !busy && !found);

  const handleSendToCheck = async () => {
    if (!found) return;
    setSending(true);
    try {
      const res = await sendReturnToCheck(found.orderId, user?.id, user?.name);
      toast({
        title: 'Возврат принят на осмотр',
        description: `Стикер хранения ${res.storageBarcode} — отнесите вещь в цех`,
      });
      setFound(null);
      onDone();
      focusInput();
    } catch (e) {
      toast({
        title: 'Не удалось принять',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleNext = () => {
    setFound(null);
    setError(null);
    focusInput();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" onClick={onOpenCreate}>
          <Icon name="PackageCheck" size={16} className="mr-2" />
          Принять новые возвраты
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Сканер возвратов с маркетплейса</DialogTitle>
        </DialogHeader>

        {found ? (
          // Вещь опознана: слева карточка, справа действия.
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <div className="space-y-3">
              <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3">
                <p className="font-bold text-emerald-900">{found.product || 'Товар'}</p>
                <p className="text-sm text-emerald-900">Заказ {found.orderNumber}</p>
              </div>

              <div className="rounded-md border border-border p-3">
                <Row label="Материал" value={found.material} />
                <Row
                  label="Ширина / высота"
                  value={found.width && found.height ? `${found.width} × ${found.height}` : null}
                />
                <Row label="Кроил" value={found.cutterName} />
                <Row label="Сшил" value={found.sewerName} />
                <Row label="Упаковал" value={found.packerName} />
                <Row label="Заказ создан" value={formatDate(found.createdAt)} />
                <Row label="Отменён" value={formatDate(found.cancelledAt)} />
              </div>

              {/* Почему покупатель отказался — по этому кладовщик понимает, чего ждать
                  от вещи: отказ при вручении обычно значит, что она как новая. */}
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs font-medium text-amber-900">Причина возврата</p>
                <p className="mt-0.5 text-sm text-amber-900">
                  {found.returnReason || 'Маркетплейс не указал причину'}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 md:w-52">
              <Button size="lg" onClick={handleSendToCheck} disabled={sending}>
                <Icon
                  name={sending ? 'Loader2' : 'Wrench'}
                  size={18}
                  className={`mr-2 ${sending ? 'animate-spin' : ''}`}
                />
                Отправить на осмотр в цех
              </Button>
              <Button size="lg" variant="outline" onClick={handleNext}>
                <Icon name="ScanLine" size={18} className="mr-2" />
                Следующий возврат
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="space-y-4"
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest('input, button, a')) focusInput();
            }}
          >
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-sm text-muted-foreground">
                Отсканируйте ярлык FBS на приехавшей вещи. Заказы, которые ещё не были
                у покупателя, система принять не даст
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Ярлык отправления</p>
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

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <Icon name="CircleAlert" size={18} className="mt-0.5 shrink-0 text-destructive" />
                <p className="text-sm">{error}</p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ReceiveReturnDialog;
