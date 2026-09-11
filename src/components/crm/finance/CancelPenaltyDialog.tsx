import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { cancelPenalty } from '@/lib/salaryApi';
import { formatMoney } from '@/components/crm/finance/financeShared';

interface Props {
  id: number;
  userName: string;
  amount: number;
  description: string;
  onDone: () => void;
}

/**
 * Отмена уже выплаченного штрафа.
 *
 * Удалить его нельзя: деньги удержаны и выданы, стирание строки развалило бы
 * расчётный лист и историю выплат. Раньше выхода не было вовсе — у выплаченных
 * начислений кнопки просто не показывались, и админ упирался в стену.
 *
 * Поэтому прошлое не переписываем, а исправляем открыто: сотруднику возвращается
 * та же сумма отдельным начислением, штраф остаётся в истории с пометкой
 * «отменён». Видно и наказание, и отмену, и кто её сделал.
 */
const CancelPenaltyDialog = ({ id, userName, amount, description, onDone }: Props) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const refund = Math.abs(amount);

  const submit = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await cancelPenalty(id, reason.trim());
      toast({
        title: 'Штраф отменён',
        description: `${userName} получит ${formatMoney(refund)} ₽ в следующую выплату`,
      });
      setOpen(false);
      setReason('');
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось отменить штраф',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title="Отменить штраф — вернуть сумму сотруднику"
        >
          <Icon name="Undo2" size={14} />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="Undo2" size={20} />
            Отменить штраф
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md bg-muted p-3 text-sm">
            <p className="font-medium">{userName}</p>
            <p className="mt-0.5 text-muted-foreground">{description}</p>
            <p className="mt-1 text-2xl font-bold">{formatMoney(refund)} ₽</p>
          </div>

          {/* Честно объясняем, что произойдёт: деньги уже удержаны, поэтому
              штраф не стирается, а компенсируется отдельным начислением. */}
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Штраф уже выплачен, поэтому удалить его нельзя — разошёлся бы расчётный
            лист. Сотруднику вернётся <b>{formatMoney(refund)} ₽</b> отдельным
            начислением в следующую выплату, а штраф останется в истории с пометкой
            «отменён».
          </div>

          <div className="space-y-1.5">
            <Label>Причина отмены</Label>
            <Input
              autoFocus
              placeholder="Разобрались: виноват поставщик, а не сотрудник"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && reason.trim() && submit()}
            />
            <p className="text-xs text-muted-foreground">
              Останется в расчётном листе сотрудника и в журнале
            </p>
          </div>
        </div>

        <DialogFooter>
          <div className="flex w-full gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              className="flex-1"
              onClick={submit}
              disabled={!reason.trim() || busy}
            >
              {busy ? 'Отменяем…' : 'Вернуть деньги'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CancelPenaltyDialog;
