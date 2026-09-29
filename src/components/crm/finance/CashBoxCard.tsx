import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { CashBoxTransaction } from '@/lib/salaryApi';
import { formatDateTime, formatMoney } from '@/components/crm/finance/financeShared';
import TablePager from '@/components/crm/finance/TablePager';
import { useTablePage } from '@/components/crm/finance/useTablePage';
import CashDepositDialog from '@/components/crm/finance/CashDepositDialog';

interface CashBoxCardProps {
  balance: number;
  transactions: CashBoxTransaction[];
  loading: boolean;
  saving: boolean;
  onDeposit: (amount: number, description: string) => Promise<void>;
}

const CashBoxCard = ({ balance, transactions, loading, saving, onDeposit }: CashBoxCardProps) => {
  const { visible, page, setPage, totalPages, total } = useTablePage(transactions);

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Касса компании</CardTitle>
        <CashDepositDialog saving={saving} onSubmit={onDeposit} />
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            <div>
              <p className="text-sm text-muted-foreground">Текущий остаток кассы</p>
              <p className={`text-xl font-bold ${balance < 0 ? 'text-destructive' : ''}`}>
                {formatMoney(balance)} ₽
              </p>
            </div>

            <div className="space-y-2 lg:hidden">
              {transactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Операций по кассе пока нет</p>
              ) : (
                visible.map((t) => (
                  <div key={t.id} className="min-w-0 overflow-hidden rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-sm leading-snug">{t.description}</p>
                      <span
                        className={`shrink-0 tabular-nums font-semibold ${
                          t.amount < 0 ? 'text-destructive' : 'text-emerald-600'
                        }`}
                      >
                        {formatMoney(t.amount)} ₽
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(t.createdAt)}
                      {t.createdByName ? ` · ${t.createdByName}` : ''}
                    </p>
                  </div>
                ))
              )}
            </div>

            <div className="hidden overflow-x-auto rounded-md border border-border lg:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground">Дата</TableHead>
                    <TableHead className="text-primary-foreground">Сумма</TableHead>
                    <TableHead className="text-primary-foreground">Описание</TableHead>
                    <TableHead className="text-primary-foreground">Автор</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                        Операций по кассе пока нет
                      </TableCell>
                    </TableRow>
                  ) : (
                    visible.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="whitespace-nowrap">{formatDateTime(t.createdAt)}</TableCell>
                        <TableCell className={`whitespace-nowrap ${t.amount < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                          {formatMoney(t.amount)} ₽
                        </TableCell>
                        <TableCell className="max-w-[280px] truncate" title={t.description}>
                          {t.description}
                        </TableCell>
                        <TableCell>{t.createdByName || '—'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            <TablePager page={page} totalPages={totalPages} total={total} setPage={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default CashBoxCard;
