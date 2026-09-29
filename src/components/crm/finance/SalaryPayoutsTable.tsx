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
  error?: string | null;
  onDelete: (id: number) => void;
}

const SalaryPayoutsTable = ({ payouts, loading, error = null, onDelete }: SalaryPayoutsTableProps) => {
  const { visible, page, setPage, totalPages, total } = useTablePage(payouts);

  const empty = loading && payouts.length === 0;
  const none = payouts.length === 0;

  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Выплата зарплат</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 lg:hidden">
          {empty ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon name="Loader2" size={16} className="animate-spin" />
              Загрузка...
            </div>
          ) : none ? (
            error ? null : <p className="text-sm text-muted-foreground">Выплат пока не было</p>
          ) : (
            visible.map((p) => (
              <div key={p.id} className="min-w-0 overflow-hidden rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">{p.userName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(p.paidAt)}</p>
                    {!!p.sbpPhone && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {p.sbpPhone}
                        {p.sbpBank ? ` · ${p.sbpBank}` : ''}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 tabular-nums text-base font-bold text-emerald-700">
                    {formatMoney(p.amount)} ₽
                  </span>
                </div>
                <div className="mt-2 border-t border-border pt-2">
                  <ConfirmDeleteButton
                    title="Удалить выплату?"
                    description={`Выплата #${p.id} сотруднику ${p.userName} на сумму ${formatMoney(p.amount)} ₽ будет удалена. Связанные начисления вернутся в статус "невыплачено", а сумма вернётся в кассу компании.`}
                    onConfirm={() => onDelete(p.id)}
                  />
                </div>
              </div>
            ))
          )}
        </div>

        <div className="hidden overflow-x-auto rounded-md border border-border lg:block">
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
              {empty ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    <Icon name="Loader2" size={16} className="mr-2 inline animate-spin" />
                    Загрузка...
                  </TableCell>
                </TableRow>
              ) : none ? (
                error ? null : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    Выплат пока не было
                  </TableCell>
                </TableRow>
                )
              ) : (
                visible.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.id}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatDateTime(p.paidAt)}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatMoney(p.amount)} ₽</TableCell>
                    <TableCell>
                      <div>{p.userName}</div>
                      {!!p.sbpPhone && (
                        <div className="text-xs text-muted-foreground">
                          {p.sbpPhone}
                          {p.sbpBank ? ` · ${p.sbpBank}` : ''}
                        </div>
                      )}
                    </TableCell>
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
