import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { deleteRoll } from '@/lib/rollsApi';
import { formatQuantity } from '@/lib/formatQuantity';

interface RollRemoveDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rollId: number;
  barcode: string;
  materialName: string;
  unit: string;
  remainingQuantity: number;
  onDone: () => void;
}

/**
 * Убрать рулон из работы — с подтверждением штрихкодом.
 *
 * Рулон убирают, когда его завели ошибочно: дубль при разгрузке, опечатка,
 * приёмка оформлена дважды. Действие серьёзное — со склада пропадает материал,
 * поэтому просим набрать штрихкод руками. Случайный клик так не проходит, а
 * человек лишний раз смотрит, тот ли рулон убирает.
 *
 * Строка приёмки при этом остаётся: она первичный документ, по нему считали
 * объём поставки и расчёты с поставщиком. В приёмке позиция будет подписана
 * как убранная — видно, что она была, кто и когда её убрал.
 */
const RollRemoveDialog = ({
  open,
  onOpenChange,
  rollId,
  barcode,
  materialName,
  unit,
  remainingQuantity,
  onDone,
}: RollRemoveDialogProps) => {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirm('');
      setReason('');
    }
  }, [open]);

  const codeOk = confirm.trim().toUpperCase() === barcode.toUpperCase();
  const reasonOk = reason.trim().length >= 3;

  const handleRemove = async () => {
    setSaving(true);
    try {
      await deleteRoll(rollId, reason.trim());
      toast({
        title: 'Рулон убран со склада',
        description: 'В приёмке позиция осталась с пометкой «убран»',
      });
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось убрать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Убрать рулон из системы</DialogTitle>
          <DialogDescription>
            {materialName} · <span className="font-mono-tech">{barcode}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <Icon name="TriangleAlert" size={15} className="mt-0.5 shrink-0 text-destructive" />
            <span>
              Со склада списывается <b>{formatQuantity(remainingQuantity)} {unit}</b>{' '}
              материала. Рулон исчезнет из всех списков — кладовщик и цех его больше
              не увидят. В приёмке строка останется с пометкой «убран».
            </span>
          </p>

          <div className="space-y-1">
            <Label className="text-xs">Причина</Label>
            <Textarea
              rows={2}
              placeholder="Например: дубль при разгрузке, рулон заведён дважды"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Останется в журнале и в приёмке — по ней потом поймут, куда делся рулон
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">
              Наберите штрихкод <span className="font-mono-tech">{barcode}</span> для
              подтверждения
            </Label>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={barcode}
              className="font-mono-tech"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            onClick={handleRemove}
            disabled={saving || !codeOk || !reasonOk}
          >
            {saving && <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />}
            Убрать рулон
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RollRemoveDialog;
