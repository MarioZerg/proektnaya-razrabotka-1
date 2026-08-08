import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import Icon from '@/components/ui/icon';
import type { SalaryOperation } from '@/lib/salaryApi';
import {
  accrualTypeLabels,
  formatAccrualShift,
  formatDateTime,
  formatMoney,
} from '@/components/crm/finance/financeShared';
import EditAccrualDialog from '@/components/crm/finance/EditAccrualDialog';
import ConfirmDeleteButton from '@/components/crm/finance/ConfirmDeleteButton';

interface OperationsTableProps {
  operations: SalaryOperation[];
  loading: boolean;
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
  savingAccrual: boolean;
  onDelete: (id: number) => void;
  onEdit: (id: number, amount: number, description: string) => Promise<void>;
}

const OperationsTable = ({
  operations,
  loading,
  page,
  setPage,
  totalPages,
  savingAccrual,
  onDelete,
  onEdit,
}: OperationsTableProps) => {
  return (
    <div className="space-y-4">
      {/* Телефон: девять колонок в строку не помещаются — половину таблицы
          (сумму, описание, даты) просто срезало за краем экрана. Показываем
          то же самое карточками. На компьютере остаётся обычная таблица. */}
      <div className="space-y-2 md:hidden">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : operations.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">Начислений пока нет</p>
        ) : (
          operations.map((op) => (
            <div key={op.id} className="rounded-md border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Icon
                    name={op.amount < 0 ? 'MinusCircle' : 'PlusCircle'}
                    size={15}
                    className={op.amount < 0 ? 'text-destructive' : 'text-emerald-600'}
                  />
                  <span className="text-sm font-medium">
                    {accrualTypeLabels[op.type] || op.type}
                  </span>
                </div>
                <span
                  className={`whitespace-nowrap text-base font-bold ${
                    op.amount < 0 ? 'text-destructive' : 'text-emerald-600'
                  }`}
                >
                  {formatMoney(op.amount)} ₽
                </span>
              </div>

              <p className="mt-1 text-sm font-semibold">{op.userName}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {op.orderNumber ? `Заказ #${op.orderNumber} — ` : ''}
                {op.description}
              </p>
              {formatAccrualShift(op) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatAccrualShift(op)}
                  {op.shiftIsGuest ? ' · гость' : ''}
                </p>
              )}

              <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                <p>Начислено за: {op.accruedFor}</p>
                <p>Создано: {formatDateTime(op.createdAt)}</p>
                <p>{op.paidAt ? `Выплачено: ${formatDateTime(op.paidAt)}` : 'Ожидает выплаты'}</p>
              </div>

              {!op.paidAt && (
                <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
                  <EditAccrualDialog operation={op} saving={savingAccrual} onSubmit={onEdit} />
                  <ConfirmDeleteButton
                    title="Удалить начисление?"
                    description={`Начисление #${op.id} на сумму ${formatMoney(op.amount)} ₽ будет удалено безвозвратно.`}
                    onConfirm={() => onDelete(op.id)}
                  />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div className="hidden rounded-md border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="text-primary-foreground">#</TableHead>
              <TableHead className="text-primary-foreground">Тип</TableHead>
              <TableHead className="text-primary-foreground">Сотрудник</TableHead>
              <TableHead className="text-primary-foreground">Начислено за</TableHead>
              <TableHead className="text-primary-foreground">Сумма</TableHead>
              <TableHead className="text-primary-foreground">Описание</TableHead>
              <TableHead className="text-primary-foreground">Дата создания</TableHead>
              <TableHead className="text-primary-foreground">Дата выплаты</TableHead>
              <TableHead className="text-primary-foreground" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                  <Icon name="Loader2" size={16} className="mr-2 inline animate-spin" />
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : operations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                  Начислений пока нет
                </TableCell>
              </TableRow>
            ) : (
              operations.map((op) => (
                <TableRow key={op.id}>
                  <TableCell>{op.id}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Icon
                        name={op.amount < 0 ? 'MinusCircle' : 'PlusCircle'}
                        size={14}
                        className={op.amount < 0 ? 'text-destructive' : 'text-emerald-600'}
                      />
                      <span className="text-xs">{accrualTypeLabels[op.type] || op.type}</span>
                    </div>
                  </TableCell>
                  <TableCell>{op.userName}</TableCell>
                  <TableCell>{op.accruedFor}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatMoney(op.amount)} ₽</TableCell>
                  <TableCell className="max-w-[280px]">
                    <p className="truncate" title={op.description}>
                      {op.orderNumber ? `Заказ #${op.orderNumber} — ` : ''}
                      {op.description}
                    </p>
                    {/* За какую смену начислен оклад: при двух сменах за день видно,
                        что заплачено один раз и именно за эту смену. */}
                    {formatAccrualShift(op) && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {formatAccrualShift(op)}
                        {op.shiftIsGuest ? ' · гость' : ''}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(op.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">{op.paidAt ? formatDateTime(op.paidAt) : '—'}</TableCell>
                  <TableCell>
                    {!op.paidAt && (
                      <div className="flex items-center">
                        <EditAccrualDialog operation={op} saving={savingAccrual} onSubmit={onEdit} />
                        <ConfirmDeleteButton
                          title="Удалить начисление?"
                          description={`Начисление #${op.id} на сумму ${formatMoney(op.amount)} ₽ будет удалено безвозвратно.`}
                          onConfirm={() => onDelete(op.id)}
                        />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationLink onClick={() => setPage(Math.max(1, page - 1))} className="cursor-pointer">
                <Icon name="ChevronLeft" size={16} />
              </PaginationLink>
            </PaginationItem>
            <PaginationItem>
              <span className="px-3 text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
            </PaginationItem>
            <PaginationItem>
              <PaginationLink
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                className="cursor-pointer"
              >
                <Icon name="ChevronRight" size={16} />
              </PaginationLink>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
};

export default OperationsTable;
