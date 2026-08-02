import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { MyAccrual } from '@/lib/salaryApi';
import { accrualTypeLabels, formatDate, formatMoney } from '@/components/crm/finance/financeShared';

interface MyAccrualsTableProps {
  accruals: MyAccrual[];
  loading: boolean;
}

const MyAccrualsTable = ({ accruals, loading }: MyAccrualsTableProps) => {
  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-primary hover:bg-primary">
            <TableHead className="text-primary-foreground">Тип</TableHead>
            <TableHead className="text-primary-foreground">Заказ</TableHead>
            <TableHead className="text-primary-foreground">Описание</TableHead>
            <TableHead className="text-primary-foreground">Сумма</TableHead>
            <TableHead className="text-primary-foreground">Дата</TableHead>
            <TableHead className="text-primary-foreground">Статус</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                <Icon name="Loader2" size={16} className="mr-2 inline animate-spin" />
                Загрузка...
              </TableCell>
            </TableRow>
          ) : accruals.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                Начислений пока нет
              </TableCell>
            </TableRow>
          ) : (
            accruals.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="text-xs">{accrualTypeLabels[a.type] || a.type}</TableCell>
                <TableCell className="font-mono-tech text-xs">{a.orderNumber || '—'}</TableCell>
                <TableCell className="max-w-[280px] truncate text-xs" title={a.description}>
                  {a.description}
                </TableCell>
                <TableCell className={`whitespace-nowrap font-medium ${a.amount < 0 ? 'text-destructive' : ''}`}>
                  {formatMoney(a.amount)} ₽
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">{formatDate(a.accruedFor)}</TableCell>
                <TableCell>
                  {a.paidAt ? (
                    <span className="text-xs text-muted-foreground">Выплачено</span>
                  ) : (
                    <span className="text-xs font-medium text-amber-600">Ожидает выплаты</span>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default MyAccrualsTable;
