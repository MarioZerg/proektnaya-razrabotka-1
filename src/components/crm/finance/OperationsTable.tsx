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
  formatDate,
  formatDateTime,
  formatMoney,
} from '@/components/crm/finance/financeShared';
import { formatMeters, parseMeters } from '@/components/crm/finance/workedDay';
import EditAccrualDialog from '@/components/crm/finance/EditAccrualDialog';
import ConfirmDeleteButton from '@/components/crm/finance/ConfirmDeleteButton';
import CancelPenaltyDialog from '@/components/crm/finance/CancelPenaltyDialog';

interface OperationsTableProps {
  operations: SalaryOperation[];
  loading: boolean;
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
  savingAccrual: boolean;
  onDelete: (id: number) => void;
  onEdit: (id: number, amount: number, description: string) => Promise<void>;
  /** Перезагрузить список после отмены штрафа. */
  onReload: () => void;
  /** FRONTEND-ONLY: сбой GET — не писать «начислений пока нет». */
  error?: string | null;
}

const amountClass = (op: SalaryOperation) =>
  op.type === 'penalty'
    ? 'text-destructive'
    : op.amount < 0
      ? 'text-amber-600'
      : 'text-emerald-600';

const OperationActions = ({
  op,
  savingAccrual,
  onEdit,
  onDelete,
  onReload,
}: {
  op: SalaryOperation;
  savingAccrual: boolean;
  onEdit: (id: number, amount: number, description: string) => Promise<void>;
  onDelete: (id: number) => void;
  onReload: () => void;
}) => {
  if (!op.paidAt) {
    return (
      <div className="flex items-center gap-1">
        <EditAccrualDialog operation={op} saving={savingAccrual} onSubmit={onEdit} />
        <ConfirmDeleteButton
          title="Удалить начисление?"
          description={`Начисление #${op.id} на сумму ${formatMoney(op.amount)} ₽ будет удалено безвозвратно.`}
          onConfirm={() => onDelete(op.id)}
        />
      </div>
    );
  }
  if (op.type === 'penalty' || op.type === 'deduction') {
    return (
      <CancelPenaltyDialog
        id={op.id}
        userName={op.userName}
        amount={op.amount}
        description={op.description}
        onDone={onReload}
      />
    );
  }
  return null;
};

const OperationsTable = ({
  operations,
  loading,
  page,
  setPage,
  totalPages,
  savingAccrual,
  onDelete,
  onEdit,
  onReload,
  error = null,
}: OperationsTableProps) => {
  return (
    <div className="space-y-4">
      {/* Сайдбар съедает ширину: на md таблица из девяти колонок всё ещё
          не помещается, и её приходится двигать пальцем. Карточки до lg. */}
      <div className="space-y-2 lg:hidden">
        {loading && operations.length === 0 ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : operations.length === 0 ? (
          error ? null : (
          <p className="p-4 text-center text-sm text-muted-foreground">Начислений пока нет</p>
          )
        ) : (
          operations.map((op) => {
            const meters = parseMeters(op.description);
            return (
            <div key={op.id} className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-snug">{op.userName}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {accrualTypeLabels[op.type] || op.type}
                    {op.orderNumber ? ` · #${op.orderNumber}` : ''}
                  </p>
                </div>
                <span className={`shrink-0 tabular-nums text-base font-bold ${amountClass(op)}`}>
                  {formatMoney(op.amount)} ₽
                </span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                {meters != null && (
                  <>
                    <span className="text-muted-foreground">Метраж</span>
                    <span className="text-right tabular-nums">{formatMeters(meters)} пог.м.</span>
                  </>
                )}
                <span className="text-muted-foreground">Начислено за</span>
                <span className="text-right">{formatDate(op.accruedFor)}</span>
                <span className="text-muted-foreground">Статус</span>
                <span className="text-right">
                  {op.paidAt ? 'Выплачено' : 'Ожидает выплаты'}
                </span>
              </div>

              {op.description && (
                <p className="mt-2 text-xs leading-snug text-muted-foreground">{op.description}</p>
              )}
              {formatAccrualShift(op) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatAccrualShift(op)}
                  {op.shiftIsGuest ? ' · гость' : ''}
                </p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                Создано: {formatDateTime(op.createdAt)}
              </p>

              <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
                <OperationActions
                  op={op}
                  savingAccrual={savingAccrual}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onReload={onReload}
                />
              </div>
            </div>
            );
          })
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-md border border-border lg:block">
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
              error ? null : (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                  Начислений пока нет
                </TableCell>
              </TableRow>
              )
            ) : (
              operations.map((op) => (
                <TableRow key={op.id}>
                  <TableCell>{op.id}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Icon
                        name={op.amount < 0 ? 'MinusCircle' : 'PlusCircle'}
                        size={14}
                        className={amountClass(op)}
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
                    <OperationActions
                      op={op}
                      savingAccrual={savingAccrual}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onReload={onReload}
                    />
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
