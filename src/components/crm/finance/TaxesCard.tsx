import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import BlockSkeleton from '@/components/crm/finance/BlockSkeleton';
import ConfirmDeleteButton from '@/components/crm/finance/ConfirmDeleteButton';
import { formatDateTime, formatMoney } from '@/components/crm/finance/financeShared';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  TAX_MARKETPLACES,
  deleteTaxWriteoff,
  fetchTaxes,
  writeOffTaxes,
  type TaxSummary,
} from '@/lib/taxesApi';

const monthLabel = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

const rub = (n: number) => `${formatMoney(n)} ₽`;

/**
 * Налоги с маркетплейсов — отдельно от зарплат.
 *
 * Баланс двигается раз в месяц: 1-го числа начисляется налог за прошлый месяц
 * по отчётам OZON, WB и Яндекса. Заплатили — жмём «Списать», остаток к уплате
 * уменьшается.
 */
const TaxesCard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [data, setData] = useState<TaxSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');

  const isOwner = user?.role === 'admin';

  const load = useCallback(() => {
    if (!user?.id) return;
    fetchTaxes(user.id)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить налоги'))
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<TaxSummary>, done: string) => {
    setBusy(true);
    try {
      setData(await fn());
      toast({ title: done });
      return true;
    } catch (e) {
      toast({ title: 'Не получилось', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openWriteOff = () => {
    setAmount(data && data.balance > 0 ? data.balance.toFixed(2) : '');
    setComment('');
    setOpen(true);
  };

  const submit = async () => {
    if (!user?.id) return;
    const v = Number(amount.replace(',', '.').replace(/\s/g, ''));
    if (!(v > 0)) {
      toast({ title: 'Укажите сумму больше нуля', variant: 'destructive' });
      return;
    }
    if (await run(() => writeOffTaxes(user.id, v, comment.trim()), `Списано ${rub(v)}`)) setOpen(false);
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Налоги с маркетплейсов</CardTitle>
        {data && (
          <p className="text-sm text-muted-foreground">
            УСН {data.usnPct}% + НДС {data.vatPct}% · начисляется 1-го числа за прошлый месяц
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <BlockSkeleton rows={4} />
        ) : error || !data ? (
          <p className="text-sm text-destructive">{error || 'Нет данных'}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">К уплате</p>
                <p className="text-2xl font-bold tabular-nums">{rub(data.balance)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Начислено с {monthLabel(data.startMonth)}: {rub(data.accrued)} · уплачено {rub(data.paid)}
                </p>
              </div>
              {isOwner && (
                <Button onClick={openWriteOff} disabled={busy || data.balance <= 0}>
                  Списать
                </Button>
              )}
            </div>

            <div className="divide-y divide-border rounded-lg border border-border">
              {TAX_MARKETPLACES.map((mp) => {
                const v = data.byMarketplace[mp.code];
                const last = data.lastMonth?.byMarketplace[mp.code];
                return (
                  <div key={mp.code} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{mp.label}</p>
                      <p className="text-xs text-muted-foreground">
                        Продажи {rub(v.net)}
                        {last != null && data.lastMonth && ` · за ${monthLabel(data.lastMonth.month)} +${rub(last)}`}
                      </p>
                    </div>
                    <span className="shrink-0 tabular-nums text-sm font-semibold">{rub(v.tax)}</span>
                  </div>
                );
              })}
            </div>

            {data.waiting.length > 0 && (
              <p className="text-xs text-amber-700">
                Ждём отчёт:{' '}
                {data.waiting
                  .map(
                    (w) =>
                      `${monthLabel(w.month)} — ${w.marketplaces
                        .map((c) => TAX_MARKETPLACES.find((m) => m.code === c)?.label || c)
                        .join(', ')}`
                  )
                  .join('; ')}
              </p>
            )}

            {data.writeoffs.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Уплачено</p>
                <div className="divide-y divide-border rounded-lg border border-border">
                  {data.writeoffs.map((w) => (
                    <div key={w.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{w.comment || 'Налог уплачен'}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(w.createdAt)}
                          {w.createdByName ? ` · ${w.createdByName}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums text-sm font-semibold">{rub(w.amount)}</span>
                        {isOwner && user?.id && (
                          <ConfirmDeleteButton
                            title="Отменить списание?"
                            description={`${rub(w.amount)} вернутся в «К уплате».`}
                            onConfirm={() => run(() => deleteTaxWriteoff(user.id, w.id), 'Списание отменено')}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Списать уплаченный налог</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Сумма, ₽</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {data && <p className="text-xs text-muted-foreground">Сейчас к уплате {rub(data.balance)}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Input
                placeholder="Например: налог за октябрь"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>
            <Button className="w-full" disabled={busy} onClick={submit}>
              Списать
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default TaxesCard;
