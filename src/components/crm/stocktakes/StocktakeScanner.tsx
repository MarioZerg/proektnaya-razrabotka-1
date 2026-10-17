import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { playScanSound, playScanErrorSound, primeScanSounds, speakText } from '@/lib/scanSound';
import { scanStocktake, undoStocktakeScan, type Stocktake } from '@/lib/stocktakesApi';
import ScanErrorAlert from '@/components/crm/scan/ScanErrorAlert';
import ScanInputCard from '@/components/crm/scan/ScanInputCard';
import { fixScanLayout } from '@/lib/keyboardLayout';

interface StocktakeScannerProps {
  stocktake: Stocktake;
  onScanned: () => void;
}

/**
 * Пересчёт: кладовщик пикает стикер GW, система сама называет полку.
 *
 * Ходовой размер идёт на «Ходовую полку», остальное — на «Не ходовую».
 * Цифры в конце названия не важны. Когда на полке уже 100 вещей, берётся
 * следующая с тем же названием. При подтверждении вещь переезжает туда.
 *
 * Ленту сканов не держим на экране — мешает работе. Ошибочный пик снимается
 * одной кнопкой «убрать последний».
 */
const StocktakeScanner = ({ stocktake, onScanned }: StocktakeScannerProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [barcode, setBarcode] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);
  const [lastTitle, setLastTitle] = useState<string | null>(null);
  const [lastShelf, setLastShelf] = useState<string | null>(null);
  const [lastPopular, setLastPopular] = useState<boolean | null>(null);
  const [lastWarning, setLastWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  useEffect(() => {
    primeScanSounds();
    focusInput();
  }, []);

  const handleScan = async () => {
    const code = fixScanLayout(barcode.trim());
    if (!code || saving) return;
    setBarcode('');
    setError(null);
    setSaving(true);
    try {
      const res = await scanStocktake({
        stocktakeId: stocktake.id,
        barcode: code,
        actorId: user?.id,
        actorName: user?.name,
      });
      playScanSound();
      if (res.shelfName) speakText(res.shelfName);
      setLastBarcode(res.barcode);
      setLastTitle([res.orderNumber, res.product].filter(Boolean).join(' · ') || 'Вещь');
      setLastShelf(res.shelfName);
      setLastPopular(res.popular ?? null);
      setLastWarning(res.warning);
      onScanned();
    } catch (e) {
      playScanErrorSound();
      setError(e instanceof Error ? e.message : 'Не удалось отсканировать');
    } finally {
      setSaving(false);
      focusInput();
    }
  };

  useScannerAutoSubmit(barcode, handleScan, !saving);

  const handleUndoLast = async () => {
    if (!lastBarcode) return;
    try {
      await undoStocktakeScan(stocktake.id, lastBarcode, user?.id, user?.name);
      setLastBarcode(null);
      setLastTitle(null);
      setLastShelf(null);
      setLastPopular(null);
      setLastWarning(null);
      onScanned();
    } catch (e) {
      toast({
        title: 'Не удалось убрать скан',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return (
    <ScanInputCard
      title="Сканируйте стикеры хранения GW"
      hint="Полку назовёт система: ходовой размер — на ходовую полку, остальное — на неходовую. На полке до 100 вещей, дальше следующая с тем же названием."
      onBackgroundClick={(e) => {
        if (
          !(e.target as HTMLElement).closest(
            'input, button, a, textarea',
          )
        ) {
          focusInput();
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label>Стикер GW</Label>
          <Input
            ref={inputRef}
            autoFocus
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleScan()}
            onBlur={(e) => {
              const next = e.relatedTarget as HTMLElement | null;
              if (next?.closest('button, a, input, textarea')) return;
              focusInput();
            }}
            placeholder="Наведите сканер"
            className="h-12 font-mono-tech"
            autoComplete="off"
          />
        </div>
        {lastBarcode && (
          <Button
            type="button"
            variant="outline"
            className="h-12 shrink-0"
            onClick={handleUndoLast}
            title="Убрать последний скан"
          >
            <Icon name="Undo2" size={16} className="mr-1.5" />
            Убрать последний
          </Button>
        )}
      </div>

      {error && <ScanErrorAlert>{error}</ScanErrorAlert>}

      {lastBarcode && !error && lastShelf && (
        <div
          className={cn(
            'rounded-xl p-4 text-center text-white',
            lastPopular === false ? 'bg-slate-600' : lastPopular ? 'bg-emerald-600' : 'bg-slate-500',
          )}
        >
          <div className="text-sm opacity-90">
            {lastTitle}
            {lastPopular === false ? ' · не ходовой размер' : lastPopular ? ' · ходовой размер' : ''}
          </div>
          <div className="mt-1 text-3xl font-extrabold">{lastShelf}</div>
        </div>
      )}

      {lastBarcode && !error && (
        <p
          className={`text-sm ${
            lastWarning ? 'text-amber-800' : 'text-muted-foreground'
          }`}
        >
          Последний: <span className="font-medium text-foreground">{lastTitle}</span>
          {' · '}
          <span className="font-mono-tech">{lastBarcode}</span>
          {lastWarning ? ` — ${lastWarning}` : ''}
        </p>
      )}
    </ScanInputCard>
  );
};

export default StocktakeScanner;
