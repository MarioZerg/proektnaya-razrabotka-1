import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { MyPayout } from '@/lib/salaryApi';
import { formatDateTime, formatMoney } from '@/components/crm/finance/financeShared';
import TablePager from '@/components/crm/finance/TablePager';
import { useTablePage } from '@/components/crm/finance/useTablePage';

interface MyPayoutsCardProps {
  payouts: MyPayout[];
  loading: boolean;
}

const MyPayoutsCard = ({ payouts, loading }: MyPayoutsCardProps) => {
  const { visible, page, setPage, totalPages, total } = useTablePage(payouts);

  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Последние выплаты</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : payouts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Выплат пока не было</p>
        ) : (
          visible.map((p) => (
            <div key={p.id} className="flex items-center justify-between border-b border-border pb-2 text-sm last:border-0">
              <span className="text-muted-foreground">{formatDateTime(p.paidAt)}</span>
              <span className="font-semibold text-emerald-600">{formatMoney(p.amount)} ₽</span>
            </div>
          ))
        )}
        <TablePager page={page} totalPages={totalPages} total={total} setPage={setPage} />
      </CardContent>
    </Card>
  );
};

export default MyPayoutsCard;
