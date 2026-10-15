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
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import ScanErrorAlert from '@/components/crm/scan/ScanErrorAlert';
import ScanInputCard from '@/components/crm/scan/ScanInputCard';
import { fixScanLayout } from '@/lib/keyboardLayout';

interface StocktakeScannerProps {
  stocktake: Stocktake;
  onScanned: () => void;
}

/**
 * Пересчёт полки: кладовщик выбирает полку, у которой стоит, и пикает стикеры GW.
 *
 * Полка выбирается один раз на стеллаж, а не на каждую вещь: так система понимает,
 * что вещь лежит не там, где числится, и при подтверждении сама поправит адрес.
 *
 * Ленту сканов не держим на экране — мешает работе. Ошибочный пик снимается
 * одной кнопкой «убрать последний».
 *
 * POEHALI: scanStocktake уже есть. FRONTEND-ONLY: HID-скан и выбор полки на экране.
 */
const StocktakeScanner = ({ stocktake, onScanned }: StocktakeScannerProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [shelvesError, setShelvesError] = useState<string | null>(null);
  const [shelfId, setShelfId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);
  const [lastTitle, setLastTitle] = useState<string | null>(null);
  const [lastWarning, setLastWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  const loadShelves = () => {
    setShelvesError(null);
    fetchShelves()
      .then(setShelves)
      .catch((e) => {
        setShelvesError(e instanceof Error ? e.message : 'Не удалось загрузить полки');
      });
  };

  useEffect(() => {
    primeScanSounds();
    loadShelves();
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
        shelfId: shelfId ? Number(shelfId) : null,
        actorId: user?.id,
        actorName: user?.name,
      });
      playScanSound();
      setLastBarcode(res.barcode);
      setLastTitle([res.orderNumber, res.product].filter(Boolean).join(' · ') || 'Вещь');
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

  const shelfName = shelves.find((s) => String(s.id) === shelfId)?.name;

  return (
    <ScanInputCard
      title="Сканируйте стикеры хранения GW"
      hint={
        shelfName
          ? `Полка «${shelfName}» — вещи с другой полки система заметит сама`
          : 'Сначала выберите полку, у которой стоите'
      }
      onBackgroundClick={(e) => {
        if (
          !(e.target as HTMLElement).closest(
            'input, button, a, textarea, [role="combobox"]',
          )
        ) {
          focusInput();
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label>Полка</Label>
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
          <Label>Стикер GW</Label>
          <Input
            ref={inputRef}
            autoFocus
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleScan()}
            onBlur={(e) => {
              const next = e.relatedTarget as HTMLElement | null;
              if (next?.closest('button, a, input, textarea, [role="combobox"]')) return;
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

      {shelvesError && (
        <WarehouseFetchError
          title="Не удалось загрузить полки"
          description={shelvesError}
          onRetry={loadShelves}
        />
      )}

      {error && <ScanErrorAlert>{error}</ScanErrorAlert>}

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
