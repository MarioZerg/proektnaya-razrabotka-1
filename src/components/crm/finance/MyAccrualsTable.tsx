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
    <>
    {/* Свою зарплату сотрудники смотрят в основном с телефона — там карточки. */}
    <div className="space-y-2 md:hidden">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      ) : accruals.length === 0 ? (
        <p className="text-sm text-muted-foreground">Начислений пока нет</p>
      ) : (
        accruals.map((a) => (
          <div key={a.id} className="rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-medium">
                {accrualTypeLabels[a.type] || a.type}
              </span>
              <span
                className={`whitespace-nowrap font-semibold ${
                  a.amount < 0 ? 'text-destructive' : ''
                }`}
              >
                {formatMoney(a.amount)} ₽
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{formatDate(a.accruedFor)}</span>
              {a.paidAt ? (
                <span className="text-muted-foreground">Выплачено</span>
              ) : (
                <span className="font-medium text-amber-600">Ожидает выплаты</span>
              )}
            </div>
          </div>
        ))
      )}
    </div>

    <div className="hidden rounded-md border border-border md:block">
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
    </>
  );
};

export default MyAccrualsTable;
