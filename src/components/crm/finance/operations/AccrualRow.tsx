import type { SalaryOperation } from '@/lib/salaryApi';
import {
  accrualTypeLabels,
  financeOrderLabel,
  formatAccrualShift,
  formatDateTime,
  formatMoney,
} from '@/components/crm/finance/financeShared';
import { formatMeters, parseMeters } from '@/components/crm/finance/workedDay';
import EditAccrualDialog from '@/components/crm/finance/EditAccrualDialog';
import ConfirmDeleteButton from '@/components/crm/finance/ConfirmDeleteButton';
import CancelPenaltyDialog from '@/components/crm/finance/CancelPenaltyDialog';
import { amountClass } from '@/components/crm/finance/operations/operationsGrouping';

export interface AccrualActionsProps {
  savingAccrual: boolean;
  onEdit: (id: number, amount: number, description: string) => Promise<void>;
  onDelete: (id: number) => void;
  onReload: () => void;
}

const OperationActions = ({
  op,
  savingAccrual,
  onEdit,
  onDelete,
  onReload,
}: AccrualActionsProps & { op: SalaryOperation }) => {
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

const AccrualRow = ({
  op,
  savingAccrual,
  onEdit,
  onDelete,
  onReload,
}: AccrualActionsProps & { op: SalaryOperation }) => {
  const meters = parseMeters(op.description);
  const orderLabel = financeOrderLabel(op.orderNumber);
  return (
    <div className="min-w-0 border-t border-border px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug">
            {accrualTypeLabels[op.type] || op.type}
          </p>
          {orderLabel ? (
            <p className="mt-0.5 break-all text-sm font-semibold leading-snug">
              Заказ {orderLabel}
            </p>
          ) : null}
          {op.description ? (
            <p className="mt-0.5 break-words text-xs leading-snug text-muted-foreground">
              {op.description}
            </p>
          ) : null}
          {formatAccrualShift(op) ? (
            <p className="mt-0.5 break-words text-xs text-muted-foreground">
              {formatAccrualShift(op)}
              {op.shiftIsGuest ? ' · гость' : ''}
            </p>
          ) : null}
        </div>
        <span className={`shrink-0 tabular-nums text-sm font-bold ${amountClass(op)}`}>
          {formatMoney(op.amount)} ₽
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {meters != null && <span>{formatMeters(meters)} пог.м.</span>}
        <span>{op.paidAt ? `выплачено ${formatDateTime(op.paidAt)}` : 'ожидает выплаты'}</span>
        <span>создано {formatDateTime(op.createdAt)}</span>
      </div>
      <div className="mt-2">
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
};

export default AccrualRow;
