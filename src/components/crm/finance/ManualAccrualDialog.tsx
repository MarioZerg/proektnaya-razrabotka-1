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

interface ManualAccrualDialogProps {
  employees: Employee[];
  mode: 'accrual' | 'penalty';
  saving: boolean;
  onSubmit: (userId: number, amount: number, description: string) => Promise<void>;
}

const ManualAccrualDialog = ({ employees, mode, saving, onSubmit }: ManualAccrualDialogProps) => {
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
        <Button variant={mode === 'penalty' ? 'destructive' : 'default'}>
          <Icon name={mode === 'penalty' ? 'AlertTriangle' : 'Plus'} size={16} className="mr-2" />
          {mode === 'penalty' ? 'Выписать штраф' : 'Ручное начисление'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'penalty' ? 'Выписать штраф' : 'Ручное начисление средств'}</DialogTitle>
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
              placeholder={mode === 'penalty' ? 'Причина штрафа' : 'За что начисление'}
            />
          </div>
          <Button className="w-full" onClick={handleSubmit} disabled={saving || !userId || !amount || !description.trim()}>
            {saving ? 'Сохранение...' : mode === 'penalty' ? 'Выписать штраф' : 'Начислить'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ManualAccrualDialog;
