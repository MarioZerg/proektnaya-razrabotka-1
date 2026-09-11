import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { moveRoll } from '@/lib/rollsApi';
import type { Workshop } from '@/lib/workshopsApi';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rollId: number;
  barcode: string;
  materialName: string;
  /** Где рулон сейчас: от этого зависит, что предлагать. */
  status: string;
  workshopId?: number | null;
  workshopName?: string | null;
  shiftNumber?: number | null;
  workshops: Workshop[];
  onDone: () => void;
}

/**
 * Перемещение рулона администратором.
 *
 * Два случая из жизни цеха:
 *  1. Рулон уехал в цех, а там не нужен — смену закрыли, заказ отменили, ткань не
 *     подошла. Его возвращают на склад.
 *  2. Материал нужен соседней смене. Раньше ради этого рулон «возвращали» на склад
 *     и тут же выдавали заново: ткань физически не двигалась, а в системе плодились
 *     два движения, которых не было, и кладовщик тратил время на пустой круг.
 *     Теперь смена меняется одним действием.
 *
 * Причина обязательна: перемещение материала на десятки тысяч рублей должно
 * оставлять именной след в журнале.
 */
const RollMoveDialog = ({
  open,
  onOpenChange,
  rollId,
  barcode,
  materialName,
  status,
  workshopId,
  workshopName,
  shiftNumber,
  workshops,
  onDone,
}: Props) => {
  const { toast } = useToast();
  const inWorkshop = status === 'in_workshop';

  const [target, setTarget] = useState<'storage' | 'workshop'>(
    inWorkshop ? 'storage' : 'workshop',
  );
  const [wsId, setWsId] = useState<string>('');
  const [shift, setShift] = useState<string>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Рулон в цехе чаще всего возвращают на склад, со склада — выдают в цех.
    setTarget(inWorkshop ? 'storage' : 'workshop');
    // Подставляем текущий цех: при передаче между сменами менять его не нужно.
    setWsId(workshopId ? String(workshopId) : '');
    setShift('');
    setReason('');
  }, [open, inWorkshop, workshopId]);

  const selectedWs = workshops.find((w) => w.id === Number(wsId));
  const shiftOptions = Array.from(
    { length: selectedWs?.shiftsCount || 0 },
    (_, i) => i + 1,
  );

  const valid =
    reason.trim().length > 0 &&
    (target === 'storage' || (!!wsId && !!shift));

  const submit = async () => {
    setBusy(true);
    try {
      const res = await moveRoll({
        id: rollId,
        target,
        reason: reason.trim(),
        workshopId: target === 'workshop' ? Number(wsId) : undefined,
        shiftNumber: target === 'workshop' ? Number(shift) : undefined,
      });
      toast({
        title: target === 'storage' ? 'Рулон вернулся на склад' : 'Рулон передан',
        description: res.needsAccept
          ? 'Цех должен принять рулон на терминале — до этого он в раскрой не пойдёт'
          : 'Материал остался в цехе, принимать заново не нужно',
      });
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось переместить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="ArrowRightLeft" size={20} />
            Переместить рулон
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium">{materialName}</p>
            <p className="font-mono-tech text-muted-foreground">{barcode}</p>
            <p className="mt-1 text-muted-foreground">
              Сейчас:{' '}
              {inWorkshop
                ? `${workshopName || 'цех'}, смена ${shiftNumber ?? '—'}`
                : 'на складе'}
            </p>
          </div>

          {/* Со склада возвращать некуда — выбор нужен только рулону из цеха. */}
          {inWorkshop && (
            <div className="space-y-1.5">
              <Label>Куда перемещаем</Label>
              <Select
                value={target}
                onValueChange={(v) => setTarget(v as 'storage' | 'workshop')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="storage">Вернуть на склад</SelectItem>
                  <SelectItem value="workshop">Передать цеху или смене</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {target === 'workshop' && (
            <>
              <div className="space-y-1.5">
                <Label>Цех</Label>
                <Select
                  value={wsId}
                  onValueChange={(v) => {
                    setWsId(v);
                    setShift('');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите цех" />
                  </SelectTrigger>
                  <SelectContent>
                    {workshops.map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Смена</Label>
                <Select value={shift} onValueChange={setShift} disabled={!wsId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите смену" />
                  </SelectTrigger>
                  <SelectContent>
                    {shiftOptions.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {selectedWs?.shiftNames?.[n - 1] || `Смена № ${n}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Честно говорим, чем обернётся выбор: передача внутри цеха ничего
                  не требует, а перевозка в другой цех — приёмки на терминале. */}
              {inWorkshop && !!wsId && (
                <p className="text-xs text-muted-foreground">
                  {Number(wsId) === workshopId
                    ? 'Ткань остаётся в этом же цехе — принимать её заново не нужно'
                    : 'Рулон поедет в другой цех — там его должны принять на терминале'}
                </p>
              )}
            </>
          )}

          <div className="space-y-1.5">
            <Label>Причина</Label>
            <Input
              placeholder="Смену закрыли, материал не нужен"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && valid && submit()}
            />
            <p className="text-xs text-muted-foreground">
              Останется в журнале вместе с вашим именем
            </p>
          </div>
        </div>

        <DialogFooter>
          <div className="flex w-full gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button className="flex-1" onClick={submit} disabled={!valid || busy}>
              {busy ? 'Перемещение…' : 'Переместить'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RollMoveDialog;
