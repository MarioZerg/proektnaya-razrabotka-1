import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import type { Shelf } from '@/lib/shelvesApi';
import { useAuth } from '@/context/AuthContext';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { moveGoodsShelfByBarcode } from '@/lib/goodsWarehouseApi';
import { playScanSound, playScanErrorSound, primeScanSounds } from '@/lib/scanSound';

interface MoveShelfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenCreate: () => void;
  shelves: Shelf[];
  onDone: () => void;
}

/** Одна переложенная вещь — короткая строка для проверки глазами. */
interface MovedRow {
  key: number;
  ok: boolean;
  barcode: string;
  product?: string | null;
  fromShelf?: string | null;
  error?: string;
}

/**
 * Смена полки — раскладка вещей пачкой.
 *
 * Кладовщик стоит у стеллажа: выбирает полку один раз и накидывает на неё вещь за вещью,
 * пока не закончит ряд. Потом переключает полку сверху — и продолжает на следующую.
 * Диалог при этом не закрывается: раньше на каждую вещь приходилось заново открывать
 * окно и заново выбирать полку, и перекладка десятка вещей превращалась в морока.
 *
 * Каждый успешный перенос звучит сигналом — кладовщик смотрит на стеллаж, а не в экран.
 */
const MoveShelfDialog = ({
  open,
  onOpenChange,
  onOpenCreate,
  shelves,
  onDone,
}: MoveShelfDialogProps) => {
  const { user } = useAuth();

  const [shelfId, setShelfId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<MovedRow[]>([]);
  /** Сколько вещей уложено на КАЖДУЮ полку за сессию — прогресс раскладки. */
  const [perShelf, setPerShelf] = useState<Record<string, number>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 0);

  useEffect(() => {
    if (open) {
      primeScanSounds();
      setBarcode('');
      setRows([]);
      setPerShelf({});
      setShelfId('');
    }
  }, [open]);

  // Полку выбрали — сразу ставим курсор в поле скана, чтобы кладовщик не искал мышкой.
  useEffect(() => {
    if (shelfId) focusInput();
  }, [shelfId]);

  const shelfName = shelves.find((s) => String(s.id) === shelfId)?.name || '';

  const handleScan = async () => {
    const code = barcode.trim();
    if (!code || !shelfId) return;
    setBarcode('');
    setBusy(true);
    try {
      const res = await moveGoodsShelfByBarcode(
        code,
        Number(shelfId),
        user?.id,
        user?.name
      );
      playScanSound();
      setRows((prev) =>
        [
          {
            key: Date.now(),
            ok: true,
            barcode: code,
            product: res.product,
            fromShelf: res.fromShelf,
          },
          ...prev,
        ].slice(0, 12)
      );
      setPerShelf((prev) => ({ ...prev, [shelfName]: (prev[shelfName] || 0) + 1 }));
      onDone();
    } catch (e) {
      playScanErrorSound();
      setRows((prev) =>
        [
          {
            key: Date.now(),
            ok: false,
            barcode: code,
            error: e instanceof Error ? e.message : 'Не удалось переложить',
          },
          ...prev,
        ].slice(0, 12)
      );
    } finally {
      setBusy(false);
      // Фокус возвращаем всегда — в том числе после ошибки, чтобы не сбивать ритм.
      focusInput();
    }
  };

  useScannerAutoSubmit(barcode, handleScan, !!shelfId && !busy);

  const totalMoved = Object.values(perShelf).reduce((a, b) => a + b, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" onClick={onOpenCreate}>
          <Icon name="ArrowLeftRight" size={16} className="mr-2" />
          Смена полки
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Раскладка по полкам</DialogTitle>
        </DialogHeader>

        <div
          className="space-y-4"
          onClick={(e) => {
            if (!(e.target as HTMLElement).closest('input, button, a, [role="combobox"]')) {
              focusInput();
            }
          }}
        >
          {/* Полка сверху: выбрал один раз — накидываешь пачкой, потом переключаешь. */}
          <div className="space-y-1.5">
            <Label>Куда кладём</Label>
            <Select value={shelfId} onValueChange={setShelfId}>
              <SelectTrigger className="h-12 text-base">
                <SelectValue placeholder="Выберите полку" />
              </SelectTrigger>
              <SelectContent>
                {shelves.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                    {perShelf[s.name] ? ` · уложено ${perShelf[s.name]}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {shelfId ? (
            <div className="space-y-1.5">
              <Label>Сканируйте вещи для полки «{shelfName}»</Label>
              <Input
                ref={inputRef}
                autoFocus
                placeholder="Наведите сканер на стикер хранения"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                onBlur={focusInput}
                className="h-12 font-mono-tech text-lg"
                autoComplete="off"
              />
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border p-4 text-center">
              <p className="text-sm text-muted-foreground">
                Сначала выберите полку — потом сканируйте вещи одну за другой
              </p>
            </div>
          )}

          {totalMoved > 0 && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
              <p className="text-2xl font-bold text-emerald-700">{totalMoved}</p>
              <p className="text-sm text-emerald-900">
                переложено за сессию
                {Object.keys(perShelf).length > 1
                  ? ` · полок: ${Object.keys(perShelf).length}`
                  : ''}
              </p>
            </div>
          )}

          {rows.length > 0 && (
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {rows.map((r) =>
                r.ok ? (
                  <div
                    key={r.key}
                    className="flex items-start gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-2.5"
                  >
                    <Icon
                      name="CircleCheck"
                      size={16}
                      className="mt-0.5 shrink-0 text-emerald-600"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-emerald-900">
                        {r.product || 'Товар'}
                      </p>
                      <p className="text-xs text-emerald-900">
                        {r.fromShelf ? `${r.fromShelf} → ` : ''}
                        {shelfName} · {r.barcode}
                      </p>
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
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MoveShelfDialog;
