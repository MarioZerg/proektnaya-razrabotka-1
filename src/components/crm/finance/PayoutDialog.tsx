import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import type { Employee } from '@/lib/usersApi';
import { fetchSalarySummary } from '@/lib/salaryApi';
import { formatMoney } from '@/components/crm/finance/financeShared';

interface PayoutDialogProps {
  employees: Employee[];
  saving: boolean;
  onSubmit: (userId: number) => Promise<void>;
}

const PayoutDialog = ({ employees, saving, onSubmit }: PayoutDialogProps) => {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);

  useEffect(() => {
    if (!userId) {
      setBalance(null);
      return;
    }
    setLoadingBalance(true);
    fetchSalarySummary({ userId: Number(userId) })
      .then((data) => setBalance(data.totalUnpaid))
      .finally(() => setLoadingBalance(false));
  }, [userId]);

  const handleSubmit = async () => {
    if (!userId) return;
    await onSubmit(Number(userId));
    setOpen(false);
    setUserId('');
    setBalance(null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-blue-600 text-white hover:bg-blue-700">
          <Icon name="Banknote" size={16} className="mr-2" />
          Выплатить зарплату
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Выплатить зарплату</DialogTitle>
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

          {userId && (
            <div className="rounded-md border border-border p-3 text-sm">
              {loadingBalance ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Icon name="Loader2" size={14} className="animate-spin" />
                  Загрузка баланса...
                </div>
              ) : (
                <>
                  <p className="text-muted-foreground">Текущий невыплаченный баланс</p>
                  <p className="text-lg font-bold">{formatMoney(balance || 0)} ₽</p>
                </>
              )}
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={saving || !userId || !balance || balance <= 0}
          >
            {saving ? 'Выплата...' : 'Выплатить всё'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PayoutDialog;
