import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
import { useAuth } from '@/context/AuthContext';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { printRepairSticker } from '@/lib/printRepairSticker';
import {
  fetchRepairReasons,
  lookupRepairItem,
  sendToRepair,
  type RepairReason,
} from '@/lib/repairFabricApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

interface KnownItem {
  id: number;
  material?: string | null;
  width?: number | null;
  height?: number | null;
  orderNumber?: string | null;
  storageBarcode?: string | null;
}

interface StorekeeperSendToRepairDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Если вещь уже открыта в карточке — скан не нужен. */
  item?: KnownItem | null;
  onSent?: () => void;
}

/**
 * Кладовщик кладёт брак/утиль после перепаковки в куски на перешив.
 *
 * Номер остаётся тот, что был на стикере «БРАК» (GW-…): иначе цепочка
 * заказа пропадёт. Причину спрашиваем обязательно — без неё закройщица
 * не знает, где искать дефект.
 */
const StorekeeperSendToRepairDialog = ({
  open,
  onOpenChange,
  item: known,
  onSent,
}: StorekeeperSendToRepairDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { busy: saving, run } = useSubmitGuard();
  const [reasons, setReasons] = useState<RepairReason[]>([]);
  const [reasonsError, setReasonsError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<RepairReason | null>(null);
  const [customReason, setCustomReason] = useState('');
  const [barcode, setBarcode] = useState('');
  const [lookup, setLookup] = useState<KnownItem | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const item = known?.id ? known : lookup;
  const needScan = !known?.id;

  const loadReasons = () => {
    fetchRepairReasons()
      .then((r) => {
        setReasonsError(null);
        setReasons(r.reasons);
      })
      .catch((e) => {
        setReasonsError(e instanceof Error ? e.message : 'Не удалось загрузить причины');
      });
  };

  useEffect(() => {
    if (open) loadReasons();
  }, [open]);

  useEffect(() => {
    if (!open) {
      setChosen(null);
      setCustomReason('');
      setBarcode('');
      setLookup(null);
      setLookupError(null);
    }
  }, [open]);

  const groups = useMemo(() => {
    const out: Array<{ name: string; items: RepairReason[] }> = [];
    for (const r of reasons) {
      const g = out.find((x) => x.name === r.group);
      if (g) g.items.push(r);
      else out.push({ name: r.group, items: [r] });
    }
    return out;
  }, [reasons]);

  const handleLookup = async () => {
    const code = barcode.trim();
    if (!code || scanning) return;
    setScanning(true);
    setLookupError(null);
    try {
      const r = await lookupRepairItem(code);
      if (!r.item.canSend) {
        setLookup(null);
        setLookupError(
          'В куски кладовщик добавляет только вещи со статусом брак или утилизация после перепаковки',
        );
        return;
      }
      setLookup({
        id: r.item.id,
        material: r.item.material,
        width: r.item.width,
        height: r.item.height,
        orderNumber: r.item.orderNumber,
        storageBarcode: r.item.storageBarcode,
      });
      setBarcode('');
    } catch (e) {
      setLookup(null);
      setLookupError(e instanceof Error ? e.message : 'Не удалось найти вещь');
    } finally {
      setScanning(false);
    }
  };

  useScannerAutoSubmit(barcode, handleLookup, open && needScan && !item && !scanning);

  const needsCustom = chosen?.code === 'other';
  const canSend = !!item?.id && !!chosen && (!needsCustom || customReason.trim().length > 0);

  const handleSend = () => {
    if (!item?.id || !chosen) return;
    void run(async () => {
      try {
        const r = await sendToRepair(
          item.id,
          needsCustom
            ? { label: customReason.trim() }
            : { code: chosen.code, label: chosen.label },
          { id: user?.id, name: user?.name },
          item.storageBarcode || undefined,
        );
        onOpenChange(false);
        onSent?.();
        toast({
          title: `В кусках · ${r.barcode}`,
          description: `${r.reasonLabel}. Номер тот же, что был в браке. Наклейте стикер перешива`,
        });
        setTimeout(() => {
          printRepairSticker({
            barcode: r.barcode,
            material: r.material,
            width: r.width,
            height: r.height,
            reason: r.reasonLabel,
            orderNumber: r.orderNumber || item.orderNumber,
            addedBy: 'кладовщик',
          });
        }, 300);
      } catch (e) {
        toast({
          title: 'Не удалось добавить в куски',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>В куски на перешив</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {needScan && !item && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Отсканируйте стикер брака — кусок получит тот же номер GW, цепочка заказа
                не пропадёт
              </p>
              <Input
                ref={inputRef}
                autoFocus
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleLookup()}
                placeholder="GW-000123"
                className="font-mono-tech"
                disabled={scanning}
              />
              {lookupError && <p className="text-sm text-destructive">{lookupError}</p>}
            </div>
          )}

          {item && (
            <div className="rounded-lg border border-violet-300 bg-violet-50 p-3">
              <p className="font-mono-tech text-sm font-bold text-violet-900">
                {item.storageBarcode || known?.storageBarcode}
              </p>
              <p className="text-lg font-semibold text-violet-900">
                {item.material || '—'}{' '}
                {item.width && item.height ? `${item.width}×${item.height}` : ''}
              </p>
              {item.orderNumber && (
                <p className="text-sm text-violet-800">заказ {item.orderNumber}</p>
              )}
              <p className="mt-1 text-xs text-violet-800">
                В кусках останется этот номер. Пометка: добавил кладовщик
              </p>
            </div>
          )}

          {item && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">
                Что с куском не так?
                <span className="ml-2 font-normal text-muted-foreground">обязательно</span>
              </p>
              {reasonsError ? (
                <WarehouseFetchError
                  title="Не удалось загрузить причины"
                  description={reasonsError}
                  onRetry={loadReasons}
                />
              ) : (
                groups.map((g) => (
                  <div key={g.name} className="space-y-1.5">
                    <p className="text-xs font-medium uppercase text-muted-foreground">{g.name}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {g.items.map((r) => {
                        const active = chosen?.code === r.code;
                        return (
                          <button
                            key={r.code}
                            type="button"
                            onClick={() => setChosen(r)}
                            disabled={saving}
                            className={`rounded-full border px-3 py-1 text-sm ${
                              active
                                ? 'border-violet-600 bg-violet-600 text-white'
                                : 'hover:border-violet-400'
                            }`}
                          >
                            {r.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
              {needsCustom && (
                <Input
                  autoFocus
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Напишите, что именно не так"
                  maxLength={200}
                  disabled={saving}
                />
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={saving}>
              Отмена
            </Button>
            <Button className="flex-1 bg-violet-600 hover:bg-violet-700" onClick={handleSend} disabled={saving || !canSend}>
              <Icon
                name={saving ? 'Loader2' : 'Scissors'}
                size={16}
                className={`mr-2 ${saving ? 'animate-spin' : ''}`}
              />
              {saving ? 'Добавляем…' : 'Добавить в куски'}
            </Button>
          </div>
          {item && !chosen && (
            <p className="text-center text-sm text-amber-700">Укажите проблему с куском — без неё нельзя</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StorekeeperSendToRepairDialog;
