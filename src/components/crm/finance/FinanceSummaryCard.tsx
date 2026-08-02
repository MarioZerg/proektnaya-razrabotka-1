import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { formatMoney } from '@/components/crm/finance/financeShared';

interface FinanceSummaryCardProps {
  totalToAccrue: number;
  totalDebts: number;
  period1Total: number;
  period2Total: number;
  loading: boolean;
}

const FinanceSummaryCard = ({ totalToAccrue, totalDebts, period1Total, period2Total, loading }: FinanceSummaryCardProps) => {
  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Баланс начислений</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            <div>
              <p className="text-muted-foreground">К выплате (сумма начислений по сотрудникам с положительным балансом)</p>
              <p className="text-xl font-bold">{formatMoney(totalToAccrue)} ₽</p>
            </div>
            {totalDebts < 0 && (
              <div>
                <p className="text-muted-foreground">Долги сотрудников (штрафы превысили начисления)</p>
                <p className="text-xl font-bold text-destructive">{formatMoney(totalDebts)} ₽</p>
              </div>
            )}
            <div className="space-y-2 border-t border-border pt-3">
              <p className="font-medium">Выплата 10 числа</p>
              <p className="text-xs text-muted-foreground">невыплаченные начисления за период с 20 по конец текущего месяца</p>
              <p className="font-semibold">{formatMoney(period1Total)} ₽</p>
            </div>
            <div className="space-y-2 border-t border-border pt-3">
              <p className="font-medium">Выплата 25 числа</p>
              <p className="text-xs text-muted-foreground">невыплаченные начисления за период с 1 по 19 число текущего месяца</p>
              <p className="font-semibold">{formatMoney(period2Total)} ₽</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default FinanceSummaryCard;
