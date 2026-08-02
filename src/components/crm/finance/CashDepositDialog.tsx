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
import Icon from '@/components/ui/icon';

interface CashDepositDialogProps {
  saving: boolean;
  onSubmit: (amount: number, description: string) => Promise<void>;
}

const CashDepositDialog = ({ saving, onSubmit }: CashDepositDialogProps) => {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = async () => {
    if (!amount || !description.trim()) return;
    await onSubmit(Number(amount), description.trim());
    setOpen(false);
    setAmount('');
    setDescription('');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-emerald-600 text-white hover:bg-emerald-700">
          <Icon name="Wallet" size={16} className="mr-2" />
          Пополнить кассу
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Пополнить кассу компании</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
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
              placeholder="Например: внесение выручки из банка"
            />
          </div>
          <Button className="w-full" onClick={handleSubmit} disabled={saving || !amount || !description.trim()}>
            {saving ? 'Сохранение...' : 'Пополнить'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CashDepositDialog;
