import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { playScanSound, playScanErrorSound, primeScanSounds } from '@/lib/scanSound';
import { scanInspectedToShelf } from '@/lib/goodsWarehouseApi';
import type { Shelf } from '@/lib/shelvesApi';

interface InspectedShelfScannerProps {
  shelves: Shelf[];
  /** Вещь легла на полку — обновить список и счётчики. */
  onPlaced: () => void;
}

interface PlacedRow {
  barcode: string;
  title: string;
  shelfName: string;
}

const SHELF_KEY = 'inspectedScanShelfId';

/**
 * Сканер приёмки осмотренных вещей на полку.
 *
 * Упаковщица уже наклеила стикер хранения. Кладовщик выбирает полку, у которой стоит,
 * и пикает вещи подряд — каждая сразу встаёт на эту полку. Ручного выбора строк нет:
 * положить можно только то, что реально в руках.
 */
const InspectedShelfScanner = ({ shelves, onPlaced }: InspectedShelfScannerProps) => {
  const { user } = useAuth();
  const [shelfId, setShelfId] = useState(() => localStorage.getItem(SHELF_KEY) || '');
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedRow[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  useEffect(() => {
    primeScanSounds();
  }, []);

  useEffect(() => {
    if (shelfId && !shelves.some((s) => String(s.id) === shelfId) && shelves.length) {
      setShelfId('');
    }
  }, [shelves, shelfId]);

  useEffect(() => {
    if (shelfId) {
      localStorage.setItem(SHELF_KEY, shelfId);
      focusInput();
    }
  }, [shelfId]);

  const handleScan = async () => {
    const code = barcode.trim().toUpperCase();
    if (!code || busy) return;
    setBarcode('');
    setError(null);
    if (!/^GW-\d+$/.test(code)) {
      playScanErrorSound();
      setError(`${code} — не стикер хранения GW. Сканируйте только стикер GW с осмотренной вещи`);
      focusInput();
      return;
    }
    if (!shelfId) {
      playScanErrorSound();
      setError('Сначала выберите полку');
      return;
    }
    setBusy(true);
    try {
      const send = () => scanInspectedToShelf(code, Number(shelfId), user?.id, user?.name);
      let res: Awaited<ReturnType<typeof send>> | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          res = await send();
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
      const title =
        res.material && res.width && res.height
          ? `${res.material} ${res.width}×${res.height}`
          : res.product || 'Товар';
      setPlaced((prev) => [{ barcode: res.storageBarcode, title, shelfName: res.shelfName }, ...prev]);
      onPlaced();
    } catch (e) {
      playScanErrorSound();
      setError(e instanceof Error ? e.message : 'Не удалось положить на полку');
    } finally {
      setBusy(false);
      focusInput();
    }
  };

  useScannerAutoSubmit(barcode, handleScan, !busy && !!shelfId);

  const shelfName = shelves.find((s) => String(s.id) === shelfId)?.name;

  return (
    <div className="space-y-3 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-bold text-emerald-900">
          {shelfId ? `Сканируйте вещи на полку «${shelfName ?? ''}»` : 'Выберите полку'}
        </p>
        {placed.length > 0 && (
          <span className="rounded-lg bg-emerald-600 px-3 py-1 text-base font-bold text-white">
            Принято: {placed.length}
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
        <Select value={shelfId} onValueChange={setShelfId}>
          <SelectTrigger className="h-14 bg-white text-lg">
            <SelectValue placeholder="Полка" />
          </SelectTrigger>
          <SelectContent>
            {shelves.map((sh) => (
              <SelectItem key={sh.id} value={String(sh.id)} className="text-base">
                {sh.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          ref={inputRef}
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleScan()}
          placeholder={shelfId ? 'Поднесите стикер хранения к сканеру' : 'Сначала выберите полку'}
          className="h-14 bg-white font-mono-tech text-xl"
          autoComplete="off"
          disabled={!shelfId}
        />
      </div>

      {busy && (
        <p className="flex items-center gap-2 text-sm text-emerald-800">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Кладём на полку...
        </p>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive bg-destructive/10 p-3">
          <Icon name="TriangleAlert" size={22} className="mt-0.5 shrink-0 text-destructive" />
          <p className="text-base font-medium text-destructive">{error}</p>
        </div>
      )}

      {placed.length > 0 && (
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {placed.map((p, idx) => (
            <div
              key={`${p.barcode}-${idx}`}
              className="flex items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-sm"
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
    </div>
  );
};

export default InspectedShelfScanner;