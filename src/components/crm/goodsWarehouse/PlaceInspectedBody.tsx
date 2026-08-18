import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { fetchInspection, placeInspectedBatch } from '@/lib/goodsWarehouseApi';
import { playScanSound, playScanErrorSound, primeScanSounds } from '@/lib/scanSound';
import { shortProductName } from '@/lib/shortProductName';

interface PlaceInspectedBodyProps {
  /** Вкладка открыта: по этому признаку перезагружаем список и ставим фокус. */
  active: boolean;
  /** Закрыть окно целиком — после успешной укладки. */
  onClose: () => void;
  onDone: () => void;
}

/** Одна отсканированная вещь: что это и на какую полку кладём. */
interface ScannedRow {
  barcode: string;
  product: string | null;
  orderNumber: string | null;
}

/**
 * Приём осмотренных возвратов с производства на полки хранения.
 *
 * Как работает кладовщик: забрал из цеха тележку осмотренных вещей (упаковщица уже
 * наклеила на них стикеры хранения), встал у стеллажа, выбрал полку и пикает вещи одну
 * за другой. Дошёл до другой полки — переключил её в том же окне и пикает дальше.
 * В конце один раз жмёт «Положить на полки хранения» — и всё уезжает на склад разом.
 *
 * Почему так: раньше на каждую вещь уходил отдельный запрос и отдельное окно, а смена
 * полки означала закрыть и открыть всё заново. Здесь список собирается в браузере,
 * ошибку видно сразу («это не осмотренная вещь»), а на сервер уходит одно обращение.
 *
 * Это внутренняя часть окна «Разложить по полкам» — вторая вкладка. Оба дела кладовщик
 * делает у одного стеллажа с одним сканером, поэтому и живут они в одном окне.
 */
const PlaceInspectedBody = ({ active, onClose, onDone }: PlaceInspectedBodyProps) => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [barcode, setBarcode] = useState('');
  const [rows, setRows] = useState<ScannedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Что реально можно класть на полку: осмотренное и забранное из цеха. */
  const [ready, setReady] = useState<
    { storageBarcode: string; product: string | null; orderNumber: string | null }[]
  >([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  useEffect(() => {
    if (!active) return;
    primeScanSounds();
    setRows([]);
    setBarcode('');
    setError(null);
    // Готовые к укладке вещи загружаем один раз: дальше сверяем сканы прямо в браузере,
    // и кладовщик получает ответ мгновенно, даже если связь в цехе слабая.
    fetchInspection('readyShelf')
      .then((d) =>
        setReady(
          d.items.map((i) => ({
            storageBarcode: i.storageBarcode,
            product: i.product,
            orderNumber: i.orderNumber,
          })),
        ),
      )
      .catch(() => setReady([]));
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [active]);

  const handleScan = () => {
    const code = barcode.trim();
    if (!code) return;
    setBarcode('');
    setError(null);

    if (rows.some((r) => r.barcode === code)) {
      setError(`Стикер ${code} уже в списке`);
      playScanErrorSound();
      focusInput();
      return;
    }
    const found = ready.find((r) => r.storageBarcode === code);
    if (!found) {
      setError(`${code} — не осмотренная вещь. На полку кладут только то, что упаковщица уже проверила`);
      playScanErrorSound();
      focusInput();
      return;
    }

    playScanSound();
    setRows((prev) => [
      { barcode: code, product: found.product, orderNumber: found.orderNumber },
      ...prev,
    ]);
    focusInput();
  };

  useScannerAutoSubmit(barcode, handleScan, !saving);

  const removeRow = (code: string) =>
    setRows((prev) => prev.filter((r) => r.barcode !== code));

  const handleSave = async () => {
    if (rows.length === 0) return;
    setSaving(true);
    try {
      const res = await placeInspectedBatch(
        rows.map((r) => r.barcode),
        user?.id,
        user?.name,
      );
      // Куда система разложила вещи — показываем сразу: кладовщик несёт их
      // на названные полки, выбирать ничего не нужно.
      const byShelf = new Map<string, number>();
      res.placed.forEach((p) => byShelf.set(p.shelfName, (byShelf.get(p.shelfName) || 0) + 1));
      const shelfText = [...byShelf.entries()]
        .map(([name, n]) => `${name} — ${n} шт.`)
        .join(', ');
      toast({
        title: `Положено на полки: ${res.total}`,
        description:
          res.errors.length > 0
            ? `Не удалось: ${res.errors.length}. ${shelfText}`
            : `Разложите так: ${shelfText}`,
        variant: res.errors.length > 0 ? 'destructive' : undefined,
      });
      setRows([]);
      onDone();
      onClose();
    } catch (e) {
      toast({
        title: 'Не удалось положить на полки',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="space-y-4"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('input, button, a, [role="combobox"]')) {
          focusInput();
        }
      }}
    >
      <div className="rounded-md border border-border bg-muted/40 p-3">
        <p className="text-sm text-muted-foreground">
          Сканируйте стикеры хранения один за другим. Полку система выберет сама:
          однотипный товар кладёт вместе, ходовой — ближе. В конце нажмите
          «Положить товар на полки хранения» и разложите по названным полкам
        </p>
        <p className="mt-1 text-sm">
          Готово к укладке: <span className="font-semibold">{ready.length}</span>
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Стикер хранения</Label>
        <Input
          ref={inputRef}
          autoFocus
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleScan()}
          onBlur={focusInput}
          placeholder="Наведите сканер"
          className="h-11 font-mono-tech"
          autoComplete="off"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <Icon name="CircleAlert" size={18} className="mt-0.5 shrink-0 text-destructive" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-3">
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {rows.map((r) => (
              <div
                key={r.barcode}
                className="flex items-start justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium" title={r.product || ''}>
                    {shortProductName(r)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.orderNumber || '—'} · {r.barcode}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(r.barcode)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  title="Убрать из списка"
                >
                  <Icon name="X" size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Button
        size="lg"
        className="w-full"
        onClick={handleSave}
        disabled={rows.length === 0 || saving}
      >
        <Icon
          name={saving ? 'Loader2' : 'Warehouse'}
          size={18}
          className={`mr-2 ${saving ? 'animate-spin' : ''}`}
        />
        Положить товар на полки хранения{rows.length > 0 ? ` (${rows.length})` : ''}
      </Button>
    </div>
  );
};

export default PlaceInspectedBody;
