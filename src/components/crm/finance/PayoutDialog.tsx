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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import type { Employee } from '@/lib/usersApi';
import { previewPayout, type PayoutPreview } from '@/lib/salaryApi';
import { formatMoney } from '@/components/crm/finance/financeShared';

interface PayoutDialogProps {
  employees: Employee[];
  saving: boolean;
  onSubmit: (
    userId: number,
    periodFrom?: string,
    periodTo?: string,
  ) => Promise<void>;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Быстрые периоды: закрывают привычные отрезки в один клик. */
const quickPeriods = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  const prevFrom = new Date(y, m - 1, 1);
  const prevTo = new Date(y, m, 0);
  return [
    {
      label: 'Первая половина',
      from: iso(new Date(y, m, 1)),
      to: iso(new Date(y, m, 15)),
    },
    {
      label: 'Вторая половина',
      from: iso(new Date(y, m, 16)),
      to: iso(new Date(y, m, lastDay)),
    },
    {
      label: 'Текущий месяц',
      from: iso(new Date(y, m, 1)),
      to: iso(new Date(y, m, lastDay)),
    },
    { label: 'Прошлый месяц', from: iso(prevFrom), to: iso(prevTo) },
  ];
};

const PayoutDialog = ({ employees, saving, onSubmit }: PayoutDialogProps) => {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState<PayoutPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Сумма пересчитывается при смене сотрудника или дат: админ должен видеть,
  // сколько уйдёт из кассы, ДО нажатия кнопки, а не узнавать постфактум.
  useEffect(() => {
    if (!userId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    previewPayout(Number(userId), from || undefined, to || undefined)
      .then((d) => !cancelled && setPreview(d))
      .catch(() => !cancelled && setPreview(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [userId, from, to]);

  const handleSubmit = async () => {
    if (!userId) return;
    await onSubmit(Number(userId), from || undefined, to || undefined);
    setOpen(false);
    setUserId('');
    setFrom('');
    setTo('');
    setPreview(null);
  };

  const amount = preview?.amount || 0;
  const notEnough = !!preview && preview.cashBalance < amount;
  const wholePeriod = !from && !to;

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

          <div className="space-y-1.5">
            <Label>Период</Label>
            <div className="flex flex-wrap gap-1.5">
              {quickPeriods().map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  variant={
                    from === p.from && to === p.to ? 'default' : 'outline'
                  }
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setFrom(p.from);
                    setTo(p.to);
                  }}
                >
                  {p.label}
                </Button>
              ))}
              <Button
                type="button"
                variant={wholePeriod ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setFrom('');
                  setTo('');
                }}
              >
                Всё целиком
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9"
              />
              <span className="text-xs text-muted-foreground">—</span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="h-9"
              />
            </div>
          </div>

          {/* КУДА ПЕРЕВОДИТЬ.
              Деньги уходят по СБП, а номер лежал только в профиле: чтобы
              перевести, приходилось открывать вторую вкладку и переписывать
              телефон руками. Показываем его прямо здесь, рядом с суммой. */}
          {userId && !loading && preview && (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              {preview.sbpPhone ? (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        Перевод по СБП
                      </p>
                      <p className="truncate text-base font-bold tracking-tight">
                        {preview.sbpPhone}
                      </p>
                      {!!preview.sbpBank && (
                        <p className="truncate text-xs text-muted-foreground">
                          {preview.sbpBank}
                        </p>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0"
                      onClick={() => {
                        navigator.clipboard?.writeText(preview.sbpPhone || '');
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                    >
                      <Icon
                        name={copied ? 'Check' : 'Copy'}
                        size={13}
                        className="mr-1"
                      />
                      {copied ? 'Скопировано' : 'Копировать'}
                    </Button>
                  </div>

                  {/* Неподтверждённые реквизиты — не запрет, а повод сверить:
                      деньги уйдут по этому номеру безвозвратно. */}
                  {!preview.sbpConfirmed && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                      <Icon
                        name="TriangleAlert"
                        size={12}
                        className="mt-0.5 shrink-0"
                      />
                      Реквизиты ещё не сверены администратором — проверьте номер
                      перед переводом
                    </p>
                  )}
                </>
              ) : (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Icon
                    name="Info"
                    size={13}
                    className="mt-0.5 shrink-0 text-amber-600"
                  />
                  Сотрудник не указал номер СБП в профиле.
                  {preview.loginPhone
                    ? ` Телефон для входа: ${preview.loginPhone}`
                    : ''}
                </p>
              )}
            </div>
          )}

          {userId && (
            <div className="rounded-md border border-border p-3 text-sm">
              {loading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Icon name="Loader2" size={14} className="animate-spin" />
                  Считаю сумму...
                </div>
              ) : (
                <>
                  <p className="text-muted-foreground">
                    {wholePeriod
                      ? 'Весь невыплаченный остаток'
                      : 'К выплате за выбранный период'}
                  </p>
                  <p className="text-lg font-bold">{formatMoney(amount)} ₽</p>
                  {!!preview && preview.count > 0 && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {preview.count} начислений
                      {preview.firstDate &&
                        preview.lastDate &&
                        ` · ${preview.firstDate} — ${preview.lastDate}`}
                    </p>
                  )}
                  {/* Денег в кассе может не хватить — сказать об этом надо
                      здесь, а не после нажатия отказом от сервера. */}
                  {notEnough && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-destructive">
                      <Icon
                        name="TriangleAlert"
                        size={12}
                        className="mt-0.5 shrink-0"
                      />
                      В кассе только {formatMoney(preview.cashBalance)} ₽ —
                      пополните кассу перед выплатой
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={saving || !userId || amount <= 0 || notEnough}
          >
            {saving
              ? 'Выплата...'
              : `Выплатить ${amount > 0 ? `${formatMoney(amount)} ₽` : ''}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PayoutDialog;
