import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchMarketplaceItems, type MarketplaceItem } from '@/lib/marketplaceItemsApi';
import {
  fetchRepairReasons,
  manualAddRepairPiece,
  type RepairReason,
} from '@/lib/repairFabricApi';
import { printRepairSticker } from '@/lib/printRepairSticker';
import { choiceClass } from '@/components/crm/goodsWarehouse/adminReceive/adminReceiveShared';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

type Step = 'material' | 'width' | 'height' | 'reason';

interface AddedRow {
  barcode: string;
  material: string;
  width: number;
  height: number;
  reason: string;
}

interface RepairPieceManualDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

const activeClass = 'border-violet-600 bg-violet-600 text-white hover:bg-violet-700';

/**
 * Ручной приём кусков на перешив — для отрезов без стикера RS.
 *
 * Как ручной приём на склад: ткань, затем ширина, затем высота кнопками.
 * Если нужного размера нет среди кнопок — вводится цифрами. Последним шагом
 * выбирается причина: без неё закройщица не знает, где искать брак.
 * Кусок сразу встаёт в цех, и печатается стикер с новым номером RS.
 */
const RepairPieceManualDialog = ({ open, onOpenChange, onAdded }: RepairPieceManualDialogProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [reasons, setReasons] = useState<RepairReason[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('material');
  const [material, setMaterial] = useState('');
  const [width, setWidth] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [otherText, setOtherText] = useState('');
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<AddedRow[]>([]);

  const load = () => {
    setLoadError(null);
    Promise.all([fetchMarketplaceItems(), fetchRepairReasons()])
      .then(([cat, r]) => {
        setItems(cat.items);
        setReasons(r.reasons);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Не удалось загрузить справочники'));
  };

  const resetChoice = () => {
    setStep('material');
    setMaterial('');
    setWidth(null);
    setHeight(null);
    setCustom('');
    setReasonCode('');
    setOtherText('');
  };

  useEffect(() => {
    if (!open) return;
    load();
    resetChoice();
    setAdded([]);
  }, [open]);

  const sized = useMemo(() => items.filter((i) => i.material && i.width && i.height), [items]);
  const materials = useMemo(
    () => [...new Set(sized.map((i) => i.material as string))].sort((a, b) => a.localeCompare(b, 'ru')),
    [sized],
  );
  const widths = useMemo(
    () =>
      [...new Set(sized.filter((i) => i.material === material).map((i) => i.width as number))].sort(
        (a, b) => a - b,
      ),
    [sized, material],
  );
  const heights = useMemo(
    () =>
      [
        ...new Set(
          sized.filter((i) => i.material === material && i.width === width).map((i) => i.height as number),
        ),
      ].sort((a, b) => a - b),
    [sized, material, width],
  );
  const reasonGroups = useMemo(() => {
    const map = new Map<string, RepairReason[]>();
    reasons.forEach((r) => map.set(r.group, [...(map.get(r.group) || []), r]));
    return [...map.entries()];
  }, [reasons]);

  const pickWidth = (v: number) => {
    setWidth(v);
    setCustom('');
    setStep('height');
  };
  const pickHeight = (v: number) => {
    setHeight(v);
    setCustom('');
    setStep('reason');
  };

  const applyCustom = () => {
    const v = parseInt(custom, 10);
    if (!v || v <= 0 || v > 2000) {
      toast({ title: 'Введите размер от 1 до 2000', variant: 'destructive' });
      return;
    }
    if (step === 'width') pickWidth(v);
    else if (step === 'height') pickHeight(v);
  };

  const goBack = () => {
    setCustom('');
    if (step === 'reason') {
      setHeight(null);
      setStep('height');
    } else if (step === 'height') {
      setWidth(null);
      setStep('width');
    } else {
      resetChoice();
    }
  };

  const isOther = reasonCode === 'other';
  const canSave = !!material && !!width && !!height && !!reasonCode && (!isOther || otherText.trim().length > 0);

  const save = async () => {
    if (!canSave || saving || !width || !height) return;
    setSaving(true);
    try {
      const r = await manualAddRepairPiece(
        { material, width, height, reasonCode, reasonLabel: isOther ? otherText.trim() : undefined },
        { id: user?.id, name: user?.name },
      );
      setAdded((prev) => [
        { barcode: r.barcode, material: r.material, width: r.width, height: r.height, reason: r.reasonLabel },
        ...prev,
      ]);
      printRepairSticker({
        barcode: r.barcode,
        material: r.material,
        width: r.width,
        height: r.height,
        reason: r.reasonLabel,
        addedBy: 'кладовщик',
      });
      toast({ title: `Кусок ${r.barcode} в цехе`, description: `${r.material} ${r.width}×${r.height}` });
      onAdded();
      resetChoice();
    } catch (e) {
      toast({
        title: 'Не удалось добавить кусок',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const chips = (values: number[], onPick: (v: number) => void) => (
    <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
      {values.map((v) => (
        <button key={v} type="button" disabled={saving} className={choiceClass} onClick={() => onPick(v)}>
          {v}
        </button>
      ))}
    </div>
  );

  const customInput = (
    <div className="flex gap-2">
      <Input
        type="number"
        inputMode="numeric"
        placeholder={step === 'width' ? 'Своя ширина, см' : 'Своя высота, см'}
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
        className="max-w-[200px]"
      />
      <Button type="button" variant="outline" onClick={applyCustom} disabled={!custom}>
        Далее
      </Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Принять куски вручную</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Для отрезов без стикера RS. Выберите ткань, ширину, высоту и что с куском не так —
            кусок сразу появится в цехе, а на него напечатается стикер
          </p>

          {loadError && (
            <WarehouseFetchError title="Не удалось загрузить справочники" description={loadError} onRetry={load} />
          )}

          {step !== 'material' && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {material}
                {width ? ` · ${width}` : ''}
                {height ? ` × ${height}` : ''}
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={goBack}>
                Назад
              </Button>
            </div>
          )}

          {step === 'material' && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Ткань</p>
              <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                {materials.length === 0 && !loadError ? (
                  <p className="text-sm text-muted-foreground">Загрузка…</p>
                ) : (
                  materials.map((name) => (
                    <button
                      key={name}
                      type="button"
                      disabled={saving}
                      className={choiceClass}
                      onClick={() => {
                        setMaterial(name);
                        setStep('width');
                      }}
                    >
                      {name}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {step === 'width' && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Ширина, см</p>
              {chips(widths, pickWidth)}
              {customInput}
            </div>
          )}

          {step === 'height' && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Высота, см</p>
              {chips(heights, pickHeight)}
              {customInput}
            </div>
          )}

          {step === 'reason' && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Что с куском не так</p>
              {reasonGroups.map(([group, list]) => (
                <div key={group} className="space-y-1">
                  <p className="text-xs uppercase text-muted-foreground">{group}</p>
                  <div className="flex flex-wrap gap-2">
                    {list.map((r) => (
                      <button
                        key={r.code}
                        type="button"
                        disabled={saving}
                        className={`${choiceClass} ${reasonCode === r.code ? activeClass : ''}`}
                        onClick={() => setReasonCode(r.code)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {isOther && (
                <Input
                  placeholder="Опишите, что с куском"
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  maxLength={200}
                />
              )}
              <Button
                className="w-full bg-violet-600 hover:bg-violet-700"
                disabled={!canSave || saving}
                onClick={save}
              >
                <Icon name={saving ? 'Loader2' : 'Printer'} size={16} className={`mr-2 ${saving ? 'animate-spin' : ''}`} />
                Добавить в цех и напечатать стикер
              </Button>
            </div>
          )}

          {added.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">Добавлено в цех: {added.length}</p>
              <ul className="space-y-1 text-sm">
                {added.map((a) => (
                  <li key={a.barcode} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-mono font-semibold">{a.barcode}</span> · {a.material} {a.width}×
                      {a.height} · <span className="text-muted-foreground">{a.reason}</span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        printRepairSticker({
                          barcode: a.barcode,
                          material: a.material,
                          width: a.width,
                          height: a.height,
                          reason: a.reason,
                          addedBy: 'кладовщик',
                        })
                      }
                    >
                      <Icon name="Printer" size={14} className="mr-1" />
                      Ещё раз
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RepairPieceManualDialog;
