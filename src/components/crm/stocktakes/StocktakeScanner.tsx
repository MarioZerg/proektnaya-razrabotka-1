import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { playScanSound, playScanErrorSound, primeScanSounds } from '@/lib/scanSound';
import { fetchShelves, type Shelf } from '@/lib/shelvesApi';
import { scanStocktake, undoStocktakeScan, type Stocktake } from '@/lib/stocktakesApi';

interface StocktakeScannerProps {
  stocktake: Stocktake;
  onScanned: () => void;
}

/** Последние сканы — короткая лента, чтобы кладовщик видел, что счётчик реагирует. */
interface ScanRow {
  barcode: string;
  title: string;
  warning: string | null;
}

/**
 * Пересчёт полки: кладовщик выбирает полку, у которой стоит, и пикает стикеры GW.
 *
 * Полка выбирается один раз на стеллаж, а не на каждую вещь: так система понимает,
 * что вещь лежит не там, где числится, и при подтверждении сама поправит адрес.
 */
const StocktakeScanner = ({ stocktake, onScanned }: StocktakeScannerProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [shelfId, setShelfId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  useEffect(() => {
    primeScanSounds();
    fetchShelves().then(setShelves).catch(() => setShelves([]));
    focusInput();
  }, []);

  const handleScan = async () => {
    const code = barcode.trim();
    if (!code || saving) return;
    setBarcode('');
    setError(null);
    setSaving(true);
    try {
      const res = await scanStocktake({
        stocktakeId: stocktake.id,
        barcode: code,
        shelfId: shelfId ? Number(shelfId) : null,
        actorId: user?.id,
        actorName: user?.name,
      });
      playScanSound();
      setRows((prev) =>
        [
          {
            barcode: res.barcode,
            title: [res.orderNumber, res.product].filter(Boolean).join(' · ') || 'Вещь',
            warning: res.warning,
          },
          ...prev,
        ].slice(0, 12),
      );
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

  const handleUndo = async (code: string) => {
    try {
      await undoStocktakeScan(stocktake.id, code, user?.id, user?.name);
      setRows((prev) => prev.filter((r) => r.barcode !== code));
      onScanned();
    } catch (e) {
      toast({
        title: 'Не удалось убрать скан',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const shelfName = shelves.find((s) => String(s.id) === shelfId)?.name;

  return (
    <div
      className="space-y-4 rounded-md border border-border p-4"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('input, button, a, [role="combobox"]')) {
          focusInput();
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Полка, которую считаете</Label>
          <Select value={shelfId} onValueChange={setShelfId}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите полку" />
            </SelectTrigger>
            <SelectContent>
              {shelves.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Стикер хранения GW</Label>
          <Input
            ref={inputRef}
            autoFocus
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleScan()}
            onBlur={focusInput}
            placeholder="Наведите сканер на стикер GW"
            className="h-11 font-mono-tech"
            autoComplete="off"
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {shelfName
          ? `Считаем полку «${shelfName}». Вещь с другой полки система заметит сама и поправит адрес после подтверждения`
          : 'Выберите полку — тогда система увидит вещи, лежащие не на своём месте'}
      </p>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <Icon name="CircleAlert" size={18} className="mt-0.5 shrink-0 text-destructive" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Последние сканы</p>
          {rows.map((r) => (
            <div
              key={r.barcode}
              className={`flex items-start justify-between gap-2 rounded-md border p-2.5 ${
                r.warning
                  ? 'border-amber-300 bg-amber-50'
                  : 'border-emerald-300 bg-emerald-50'
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{r.title}</p>
                <p className="font-mono-tech text-xs text-muted-foreground">{r.barcode}</p>
                {r.warning && <p className="text-xs text-amber-800">{r.warning}</p>}
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => handleUndo(r.barcode)}
                title="Убрать этот скан"
              >
                <Icon name="X" size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StocktakeScanner;
