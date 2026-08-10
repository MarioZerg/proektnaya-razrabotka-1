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
import type { SalaryPayout } from '@/lib/salaryApi';
import { formatDateTime, formatMoney } from '@/components/crm/finance/financeShared';
import ConfirmDeleteButton from '@/components/crm/finance/ConfirmDeleteButton';
import TablePager from '@/components/crm/finance/TablePager';
import { useTablePage } from '@/components/crm/finance/useTablePage';

interface SalaryPayoutsTableProps {
  payouts: SalaryPayout[];
  loading: boolean;
  onDelete: (id: number) => void;
}

const SalaryPayoutsTable = ({ payouts, loading, onDelete }: SalaryPayoutsTableProps) => {
  const { visible, page, setPage, totalPages, total } = useTablePage(payouts);

  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Выплата зарплат</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-primary hover:bg-primary">
                <TableHead className="text-primary-foreground">#</TableHead>
                <TableHead className="text-primary-foreground">Дата выплаты</TableHead>
                <TableHead className="text-primary-foreground">Сумма</TableHead>
                <TableHead className="text-primary-foreground">Сотрудник</TableHead>
                <TableHead className="text-primary-foreground" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    <Icon name="Loader2" size={16} className="mr-2 inline animate-spin" />
                    Загрузка...
                  </TableCell>
                </TableRow>
              ) : payouts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    Выплат пока не было
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.id}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(p.paidAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatMoney(p.amount)} ₽</TableCell>
                    <TableCell>{p.userName}</TableCell>
                    <TableCell>
                      <ConfirmDeleteButton
                        title="Удалить выплату?"
                        description={`Выплата #${p.id} сотруднику ${p.userName} на сумму ${formatMoney(p.amount)} ₽ будет удалена. Связанные начисления вернутся в статус "невыплачено", а сумма вернётся в кассу компании.`}
                        onConfirm={() => onDelete(p.id)}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        <TablePager page={page} totalPages={totalPages} total={total} setPage={setPage} />
      </CardContent>
    </Card>
  );
};

export default SalaryPayoutsTable;
