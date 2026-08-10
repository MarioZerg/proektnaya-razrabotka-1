import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { shipLabelGoods, type GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { printOrderMarketplaceLabel } from '@/lib/printOrderMarketplaceLabel';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';

interface ShipLabelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Вещи с полок, подобранные под новые заказы FBS и ждущие стикера отправления. */
  matched: GoodsWarehouseItem[];
  onDone: () => void;
}

/** Найденная вещь: показывается между сканированием и печатью. */
interface FoundItem {
  id: number;
  orderId: number;
  orderNumber: string;
  product: string | null;
  shelfName: string | null;
  storageBarcode: string;
  marketplace: string | null;
  orderType: string | null;
}

/**
 * Сборка товара с полок.
 *
 * Порядок для кладовщика: отсканировал стикер на вещи — увидел, что это за товар и под
 * какой заказ — нажал «Напечатать стикер» — наклеил и положил в отгрузку.
 *
 * Стикер печатается сразу после сканирования, пока вещь в руках: перепутать невозможно.
 * Раньше окно просило «наклейте стикер отправления» до сканирования, но взять его было
 * негде — отсюда и непонимание, что вообще надо делать.
 */
const ShipLabelDialog = ({ open, onOpenChange, matched, onDone }: ShipLabelDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [barcode, setBarcode] = useState('');
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [found, setFound] = useState<FoundItem | null>(null);
  const [labeled, setLabeled] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);

  const handleScan = async () => {
    const code = barcode.trim();
    if (!code) return;
    setBarcode('');
    setSaving(true);
    try {
      const res = await shipLabelGoods(code, user?.id, user?.name);
      playScanSound();
      setFound(res);
      setLabeled((prev) =>
        [`${res.orderNumber} · ${res.product || ''}`, ...prev].slice(0, 8)
      );
      onDone();
    } catch (e) {
      playScanErrorSound();
      toast({
        title: 'Не получилось',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setSaving(false);
    }
  };

  useScannerAutoSubmit(barcode, handleScan, !saving && !found);

  const handlePrint = async () => {
    if (!found) return;
    setPrinting(true);
    try {
      await printOrderMarketplaceLabel({
        id: found.orderId,
        orderNumber: found.orderNumber,
        marketplace: found.marketplace,
        orderType: found.orderType,
      });
    } catch (e) {
      toast({
        title: 'Стикер не пришёл',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPrinting(false);
    }
  };

  const handleNext = () => {
    setFound(null);
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) {
      setBarcode('');
      setLabeled([]);
      setFound(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Сборка товара с полок</DialogTitle>
        </DialogHeader>

        {found ? (
          // Вещь опознана — печатаем стикер, пока она в руках.
          <div className="space-y-4">
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4">
              <div className="flex items-start gap-2.5">
                <Icon
                  name="CircleCheck"
                  size={20}
                  className="mt-0.5 shrink-0 text-emerald-600"
                />
                <div className="min-w-0">
                  <p className="font-bold text-emerald-900">Вещь найдена</p>
                  <p className="mt-1 text-sm text-emerald-900">
                    {found.product || 'Товар'}
                  </p>
                  <p className="text-sm text-emerald-900">
                    Заказ {found.orderNumber}
                    {found.marketplace ? ` · ${found.marketplace.toUpperCase()}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-emerald-900">
                    Полка {found.shelfName || '—'} · {found.storageBarcode}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="text-sm font-medium">Что дальше</p>
              <ol className="mt-1.5 space-y-1 text-sm text-muted-foreground">
                <li>1. Напечатайте стикер и наклейте его на пакет</li>
                <li>2. Положите вещь в зону отгрузки</li>
                <li>3. Сканируйте следующую</li>
              </ol>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="lg" disabled={printing} onClick={handlePrint}>
                {printing ? (
                  <Icon name="Loader2" size={18} className="mr-2 animate-spin" />
                ) : (
                  <Icon name="Printer" size={18} className="mr-2" />
                )}
                Напечатать стикер
              </Button>
              <Button size="lg" variant="outline" onClick={handleNext}>
                Следующая вещь
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-sm font-medium">Как собирать</p>
              <ol className="mt-1.5 space-y-1 text-sm text-muted-foreground">
                <li>1. Возьмите вещь с полки из списка ниже</li>
                <li>2. Отсканируйте стикер, наклеенный на пакете</li>
                <li>3. Нажмите «Напечатать стикер» и наклейте его</li>
              </ol>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Отсканируйте стикер на вещи</p>
              <Input
                ref={inputRef}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                placeholder="Наведите сканер на штрихкод"
                className="h-12 font-mono-tech text-lg"
                autoComplete="off"
                disabled={saving}
              />
              <p className="text-xs text-muted-foreground">
                Сканер сработает сам — нажимать ничего не нужно
              </p>
            </div>

            {matched.length > 0 ? (
              <div>
                <p className="mb-1.5 text-sm font-medium">
                  Осталось собрать: {matched.length}
                </p>
                <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-border p-3">
                  {matched.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {m.reservedOrderNumber}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.product}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-medium">{m.shelfName || 'без полки'}</div>
                        <div className="font-mono-tech text-xs text-muted-foreground">
                          {m.storageBarcode}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-border p-3 text-center text-sm text-muted-foreground">
                Нет заказов, которые можно закрыть товаром с полки
              </p>
            )}

            {labeled.length > 0 && (
              <div>
                <p className="mb-1.5 text-sm font-medium">
                  Собрано в этот заход: {labeled.length}
                </p>
                <div className="space-y-1 text-sm text-muted-foreground">
                  {labeled.map((l, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Icon
                        name="Check"
                        size={14}
                        className="shrink-0 text-emerald-600"
                      />
                      <span className="truncate">{l}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ShipLabelDialog;
