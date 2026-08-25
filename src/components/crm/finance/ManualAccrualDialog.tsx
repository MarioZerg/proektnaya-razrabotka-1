import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import type { Employee } from '@/lib/usersApi';

/**
 * Три вида ручной операции с зарплатой сотрудника.
 *
 *  · accrual   — начислить деньги (премия, доплата);
 *  · penalty   — штраф: наказание за нарушение, есть вина;
 *  · deduction — удержание: человек должен компании. Спецодежда, выкупленный
 *    товар, материал для себя, погашение аванса. Вины нет, и называть это
 *    штрафом нельзя: сотрудник видит запись в своём кабинете.
 *
 * Деньги списываются одинаково, разница — в смысле и в отчётах.
 */
type DialogMode = 'accrual' | 'penalty' | 'deduction';

const MODE_TEXT: Record<
  DialogMode,
  { button: string; title: string; submit: string; hint: string; icon: string }
> = {
  accrual: {
    button: 'Ручное начисление',
    title: 'Ручное начисление средств',
    submit: 'Начислить',
    hint: 'За что начисление',
    icon: 'Plus',
  },
  penalty: {
    button: 'Выписать штраф',
    title: 'Выписать штраф',
    submit: 'Выписать штраф',
    hint: 'Причина штрафа',
    icon: 'TriangleAlert',
  },
  deduction: {
    button: 'Удержание',
    title: 'Удержать из зарплаты',
    submit: 'Удержать',
    hint: 'За что удержание: спецодежда, товар, аванс',
    icon: 'Wallet',
  },
};

interface ManualAccrualDialogProps {
  employees: Employee[];
  mode: DialogMode;
  saving: boolean;
  onSubmit: (userId: number, amount: number, description: string) => Promise<void>;
}

const ManualAccrualDialog = ({ employees, mode, saving, onSubmit }: ManualAccrualDialogProps) => {
  const text = MODE_TEXT[mode];
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = async () => {
    if (!userId || !amount || !description.trim()) return;
    await onSubmit(Number(userId), Number(amount), description.trim());
    setOpen(false);
    setUserId('');
    setAmount('');
    setDescription('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* Удержание — не наказание, поэтому кнопка не красная: красным
            выделяем только штраф, чтобы его нельзя было нажать по инерции. */}
        <Button variant={mode === 'penalty' ? 'destructive' : mode === 'deduction' ? 'outline' : 'default'}>
          <Icon name={text.icon} size={16} className="mr-2" />
          {text.button}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Сотрудник</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите сотрудника" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Сумма</Label>
            <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Описание</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={text.hint}
            />
          </div>
          {/* Сотрудник увидит эту запись у себя. Объясняем разницу прямо в
              форме, чтобы обычный расчёт за спецодежду не ушёл штрафом. */}
          {mode === 'deduction' && (
            <p className="flex items-start gap-1.5 rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
              <Icon name="Info" size={13} className="mt-0.5 shrink-0" />
              Сумма вычтется из зарплаты, но это не штраф: в кабинете сотрудника
              запись будет называться «Удержание»
            </p>
          )}
          <Button className="w-full" onClick={handleSubmit} disabled={saving || !userId || !amount || !description.trim()}>
            {saving ? 'Сохранение...' : text.submit}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ManualAccrualDialog;