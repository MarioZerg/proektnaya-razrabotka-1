import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import BlockSkeleton from '@/components/crm/finance/BlockSkeleton';
import { formatMoney } from '@/components/crm/finance/financeShared';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchShaftPremiums, payShaftPremium, type ShaftPremium } from '@/lib/varikiApi';

interface ShaftPremiumsCardProps {
  onPaid?: () => void;
}

/** Премии шахты: живые деньги, отдельно от выплат зарплаты. */
const ShaftPremiumsCard = ({ onPaid }: ShaftPremiumsCardProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [claims, setClaims] = useState<ShaftPremium[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!user?.id) return;
    setLoading(true);
    fetchShaftPremiums(user.id)
      .then((data) => {
        setClaims(data.claims);
        setTotal(data.total);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить премии шахты'))
      .finally(() => setLoading(false));
  }, [user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const pay = async (claim: ShaftPremium) => {
    if (!user?.id) return;
    setPayingId(claim.id);
    try {
      await payShaftPremium(user.id, claim.id);
      toast({
        title: 'Премия шахты выплачена',
        description: `${claim.userName || 'Сотрудник'} · ${formatMoney(claim.payout)} ₽`,
      });
      onPaid?.();
      load();
    } catch (e) {
      toast({
        title: 'Не удалось выплатить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setPayingId(null);
    }
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
        <div>
          <CardTitle className="text-base">Премии шахты</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Живые деньги из угольного мешка. Сюда не входят выплаты зарплаты: каждая горсть уходит своей транзакцией.
          </p>
        </div>
        {!loading && !error && claims.length > 0 && (
          <p className="shrink-0 tabular-nums text-sm font-semibold">{formatMoney(total)} ₽</p>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <BlockSkeleton rows={3} />
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : claims.length === 0 ? (
          <p className="text-sm text-muted-foreground">Пока никто не зачерпнул мешок.</p>
        ) : (
          <div className="divide-y divide-border">
            {claims.map((claim) => (
              <div key={claim.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{claim.userName || `Сотрудник #${claim.userId}`}</p>
                  <p className="text-xs text-muted-foreground">
                    {claim.day ? `${claim.day} числа` : 'без даты'} · {claim.percent}% мешка
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="tabular-nums text-sm font-semibold">{formatMoney(claim.payout)} ₽</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={payingId != null}
                    onClick={() => pay(claim)}
                  >
                    {payingId === claim.id ? 'Платим…' : 'Выплатить'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ShaftPremiumsCard;
