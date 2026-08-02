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
import type { SalaryOperation } from '@/lib/salaryApi';

interface EditAccrualDialogProps {
  operation: SalaryOperation;
  saving: boolean;
  onSubmit: (id: number, amount: number, description: string) => Promise<void>;
}

const EditAccrualDialog = ({ operation, saving, onSubmit }: EditAccrualDialogProps) => {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(operation.amount));
  const [description, setDescription] = useState(operation.description);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setAmount(String(operation.amount));
      setDescription(operation.description);
    }
  };

  const handleSubmit = async () => {
    if (!amount || !description.trim()) return;
    await onSubmit(operation.id, Number(amount), description.trim());
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
          <Icon name="Pencil" size={14} />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Редактировать начисление #{operation.id}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Сумма</Label>
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Описание</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <Button className="w-full" onClick={handleSubmit} disabled={saving || !amount || !description.trim()}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditAccrualDialog;
