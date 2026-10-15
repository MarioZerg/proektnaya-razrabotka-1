import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { playScanSound, playScanErrorSound, primeScanSounds, speakText } from '@/lib/scanSound';
import { scanInspectedToShelf } from '@/lib/goodsWarehouseApi';
import ScanErrorAlert from '@/components/crm/scan/ScanErrorAlert';
import ScanInputCard from '@/components/crm/scan/ScanInputCard';
import { fixScanLayout } from '@/lib/keyboardLayout';

interface InspectedShelfScannerProps {
  /** Вещь легла на полку — обновить список и счётчики. */
  onPlaced: () => void;
}

interface PlacedRow {
  barcode: string;
  title: string;
  shelfName: string;
  popular: boolean | null | undefined;
}

/**
 * Сканер приёмки осмотренных вещей на полку.
 *
 * Полку выбирает система по спросу на размер: ходовой размер — на «Ходовую полку»,
 * редкий — на «Не ходовую». Кладовщик только сканирует: после сигнала голос
 * называет полку, и на экране она крупно — кладёт вещь туда.
 */
const InspectedShelfScanner = ({ onPlaced }: InspectedShelfScannerProps) => {
  const { user } = useAuth();
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  useEffect(() => {
    primeScanSounds();
    focusInput();
  }, []);

  const handleScan = async () => {
    const code = fixScanLayout(barcode.trim()).toUpperCase();
    if (!code || busy) return;
    setBarcode('');
    setError(null);
    if (!/^GW-\d+$/.test(code)) {
      playScanErrorSound();
      setError(`${code} — не стикер хранения GW. Сканируйте только стикер GW с осмотренной вещи`);
      focusInput();
      return;
    }
    setBusy(true);
    try {
      const send = () => scanInspectedToShelf(code, user?.id, user?.name);
      if (placed.some((p) => p.barcode === code)) {
        throw new Error(`${code} уже принят на хранение — повторно не сканируется`);
      }
      let res: Awaited<ReturnType<typeof send>> | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const r = await send();
          if (r.alreadyPlaced && attempt === 0) {
            throw new Error(`${code} уже на хранении на полке «${r.shelfName}» — повторно не принимается`);
          }
          res = r;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          const transient = /База занята|Failed to fetch|NetworkError|Load failed/i.test(msg);
          if (!transient || attempt === 2) throw err;
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        }
      }
      if (!res) throw new Error('Не удалось положить на полку');
      playScanSound();
      speakText(res.shelfName);
      const title =
        res.material && res.width && res.height
          ? `${res.material} ${res.width}×${res.height}`
          : res.product || 'Товар';
      setPlaced((prev) => [
        { barcode: res.storageBarcode, title, shelfName: res.shelfName, popular: res.popular },
        ...prev,
      ]);
      onPlaced();
    } catch (e) {
      playScanErrorSound();
      setError(e instanceof Error ? e.message : 'Не удалось положить на полку');
    } finally {
      setBusy(false);
      focusInput();
    }
  };

  useScannerAutoSubmit(barcode, handleScan, !busy);

  const last = placed[0];

  return (
    <ScanInputCard
      title="Сканируйте вещи — полку подскажет система"
      headerRight={
        placed.length > 0 ? (
          <span className="rounded-lg bg-primary px-3 py-1 text-base font-bold text-primary-foreground">
            Принято: {placed.length}
          </span>
        ) : null
      }
      onBackgroundClick={(e) => {
        if (!(e.target as HTMLElement).closest('input, button, a')) focusInput();
      }}
    >
      <Input
        ref={inputRef}
        value={barcode}
        onChange={(e) => setBarcode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleScan();
          }
        }}
        placeholder="Поднесите стикер хранения к сканеру"
        className="h-12 bg-background font-mono-tech text-lg"
        autoComplete="off"
      />

      {busy && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Подбираем полку...
        </p>
      )}

      {error && <ScanErrorAlert>{error}</ScanErrorAlert>}

      {last && !error && (
        <div
          className={cn(
            'rounded-xl p-4 text-center text-white',
            last.popular === false ? 'bg-slate-600' : 'bg-emerald-600',
          )}
        >
          <div className="text-sm opacity-90">
            {last.title} · {last.popular === false ? 'не ходовой размер' : 'ходовой размер'}
          </div>
          <div className="mt-1 text-3xl font-extrabold">{last.shelfName}</div>
        </div>
      )}

      {placed.length > 0 && (
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {placed.map((p, idx) => (
            <div
              key={`${p.barcode}-${idx}`}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon name="CircleCheck" size={16} className="shrink-0 text-emerald-600" />
                <span className="truncate font-medium">{p.title}</span>
              </span>
              <span className="shrink-0 text-muted-foreground">
                <span className="font-mono-tech">{p.barcode}</span> → {p.shelfName}
              </span>
            </div>
          ))}
        </div>
      )}
    </ScanInputCard>
  );
};

export default InspectedShelfScanner;
