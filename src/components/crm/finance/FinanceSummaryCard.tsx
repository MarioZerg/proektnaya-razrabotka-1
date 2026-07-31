import { Card, CardContent } from '@/components/ui/card';
import { companyMoney, formatMoney, toPayoutBonuses, toPayoutMoney } from '@/components/crm/finance/financeShared';

const FinanceSummaryCard = () => {
  return (
    <Card className="border-border shadow-none">
      <CardContent className="space-y-3 pt-6 text-sm">
        <p className="font-semibold">Денег в компании: {formatMoney(companyMoney)}</p>
        <div>
          <p className="font-semibold">К выплате:</p>
          <p className="mt-1 text-muted-foreground">денег: {formatMoney(toPayoutMoney)} рублей</p>
          <p className="text-muted-foreground">бонусов: {toPayoutBonuses} баллов</p>
        </div>
      </CardContent>
    </Card>
  );
};

export default FinanceSummaryCard;
