import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { writeOffRoll } from '@/lib/rollsApi';
import { formatQuantity } from '@/lib/formatQuantity';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rollId: number;
  barcode: string;
  materialName: string;
  /** Сколько осталось в рулоне — больше списать нельзя. */
  remaining: number;
  unit: string;
  onDone: () => void;
}

/** Готовые причины: чаще всего материал уходит именно так. */
const REASONS = [
  'Продажа физлицу',
  'Образец покупателю',
  'Испорчен при перемотке',
  'Технологические отходы',
];

/**
 * Ручное списание метража с рулона.
 *
 * Материал не всегда уходит в пошив: его продают знакомым, отрезают на образец,
 * портят при перемотке. Без такого списания остаток в системе расходится с тем,
 * что лежит на полке, и расхождение всплывает только на инвентаризации — когда
 * вспомнить причину уже невозможно.
 *
 * Причина обязательна: списание попадает в журнал движений материала рядом с
 * приходами от поставщика, и запись «просто стало меньше» там бесполезна.
 */
const RollWriteOffDialog = ({
  open,
  onOpenChange,
  rollId,
  barcode,
  materialName,
  remaining,
  unit,
  onDone,
}: Props) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const value = parseFloat(qty.replace(',', '.'));
  const valid = !Number.isNaN(value) && value > 0 && value <= remaining;
  const tooMuch = !Number.isNaN(value) && value > remaining;

  const submit = async () => {
    setBusy(true);
    try {
      const r = await writeOffRoll(rollId, value, {
        actorId: user?.id,
        reason: reason.trim(),
      });
      toast({
        title: `Списано ${formatQuantity(value)} ${unit}`,
        description: `В рулоне осталось ${formatQuantity(r.remainingQuantity)} ${unit}`,
      });
      setQty('');
      setReason('');
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось списать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Списать материал с рулона</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">{materialName}</p>
            <p className="font-mono-tech text-xs text-muted-foreground">{barcode}</p>
            <p className="mt-1 text-muted-foreground">
              Остаток: <b className="text-foreground">{formatQuantity(remaining)} {unit}</b>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Сколько списать, {unit}</Label>
            <Input
              value={qty}
              onChange={(e) => setQty(e.target.value.replace(/[^\d.,]/g, ''))}
              placeholder="0"
              inputMode="decimal"
              autoFocus
            />
            {tooMuch && (
              <p className="text-xs text-destructive">
                В рулоне только {formatQuantity(remaining)} {unit}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Причина</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 200))}
              placeholder="Например: продажа физлицу"
            />
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {REASONS.map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setReason(r)}
                >
                  {r}
                </Button>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Списание попадёт в журнал движений материала с вашим именем. Остаток
            рулона уменьшится сразу
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={busy || !valid || !reason.trim()}>
            {busy ? (
              <Icon name="Loader2" size={15} className="mr-1.5 animate-spin" />
            ) : (
              <Icon name="Minus" size={15} className="mr-1.5" />
            )}
            Списать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RollWriteOffDialog;
