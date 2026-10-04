import { useEffect, useMemo, useState } from 'react';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import Icon from '@/components/ui/icon';
import type { SalaryOperation } from '@/lib/salaryApi';
import { roleLabels } from '@/lib/roles';
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

type EmployeeGroup = {
  userId: number;
  userName: string;
  items: SalaryOperation[];
  total: number;
  unpaid: number;
};

type RoleGroup = {
  key: string;
  label: string;
  order: number;
  employees: EmployeeGroup[];
  count: number;
  total: number;
};

type DayGroup = {
  date: string;
  roles: RoleGroup[];
  employeeCount: number;
  count: number;
  total: number;
};

/** Тип начисления → папка роли (или «Прочее» для ручных/штрафов). */
const ROLE_FOLDER: Record<string, { key: string; label: string; order: number }> = {
  cutter_cut: { key: 'cutter', label: roleLabels.cutter, order: 1 },
  sewer_piece: { key: 'sewer', label: roleLabels.sewer, order: 2 },
  overlock_piece: { key: 'overlock', label: 'Оверлок', order: 3 },
  packer_stickering: { key: 'packer', label: roleLabels.packer, order: 4 },
  packer_repack: { key: 'packer_repack', label: 'Перепаковка', order: 5 },
  storekeeper_shift: {
    key: 'storekeeper',
    label: roleLabels.storekeeper,
    order: 6,
  },
  senior_storekeeper_shift: {
    key: 'senior_storekeeper',
    label: roleLabels.senior_storekeeper,
    order: 7,
  },
  cleaner_shift: { key: 'cleaner', label: roleLabels.cleaner, order: 8 },
  admin_daily: { key: 'admin', label: roleLabels.admin, order: 9 },
  bonus: { key: 'bonus', label: 'Бонусы', order: 10 },
  manual: { key: 'manual', label: 'Ручные начисления', order: 11 },
  penalty: { key: 'penalty', label: 'Штрафы', order: 12 },
  deduction: { key: 'deduction', label: 'Удержания', order: 13 },
  penalty_refund: { key: 'penalty_refund', label: 'Возврат штрафа', order: 14 },
};

const folderFor = (type: string) =>
  ROLE_FOLDER[type] || {
    key: `other:${type}`,
    label: accrualTypeLabels[type] || type,
    order: 99,
  };

const amountClass = (op: SalaryOperation) =>
  op.type === 'penalty'
    ? 'text-destructive'
    : op.amount < 0
      ? 'text-amber-600'
      : 'text-emerald-600';

const moneyTone = (n: number) =>
  n < 0 ? 'text-destructive' : n > 0 ? 'text-emerald-700' : 'text-muted-foreground';

const pluralAccruals = (n: number) =>
  n === 1 ? 'начисление' : n < 5 ? 'начисления' : 'начислений';

const pluralPeople = (n: number) =>
  n === 1 ? 'сотрудник' : n < 5 ? 'сотрудника' : 'сотрудников';

const pluralRoles = (n: number) => (n === 1 ? 'роль' : n < 5 ? 'роли' : 'ролей');

/**
 * День → роль → сотрудники → строки.
 *
 * В цехе за день смешиваются швеи, закройщики и упаковщики. Без папки роли
 * список выглядит как мешок ФИО; с папкой сразу видно, сколько ушло на пошив
 * и сколько на раскрой, и внутри роли — кто сколько заработал.
 */
const groupByDayRoleEmployee = (operations: SalaryOperation[]): DayGroup[] => {
  // date → roleKey → userId → EmployeeGroup
  const byDate = new Map<
    string,
    Map<string, { meta: { key: string; label: string; order: number }; byUser: Map<number, EmployeeGroup> }>
  >();

  for (const op of operations) {
    const date = (op.accruedFor || '').slice(0, 10);
    const folder = folderFor(op.type);

    let byRole = byDate.get(date);
    if (!byRole) {
      byRole = new Map();
      byDate.set(date, byRole);
    }

    let roleBucket = byRole.get(folder.key);
    if (!roleBucket) {
      roleBucket = { meta: folder, byUser: new Map() };
      byRole.set(folder.key, roleBucket);
    }

    let emp = roleBucket.byUser.get(op.userId);
    if (!emp) {
      emp = {
        userId: op.userId,
        userName: op.userName,
        items: [],
        total: 0,
        unpaid: 0,
      };
      roleBucket.byUser.set(op.userId, emp);
    }
    emp.items.push(op);
    emp.total += op.amount;
    if (!op.paidAt) emp.unpaid += 1;
  }

  return [...byDate.entries()]
    .map(([date, byRole]) => {
      const roles: RoleGroup[] = [...byRole.values()]
        .map(({ meta, byUser }) => {
          const employees = [...byUser.values()].sort(
            (a, b) => b.total - a.total || a.userName.localeCompare(b.userName, 'ru'),
          );
          return {
            key: meta.key,
            label: meta.label,
            order: meta.order,
            employees,
            count: employees.reduce((s, e) => s + e.items.length, 0),
            total: employees.reduce((s, e) => s + e.total, 0),
          };
        })
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'ru'));

      const employeeIds = new Set<number>();
      for (const role of roles) {
        for (const emp of role.employees) employeeIds.add(emp.userId);
      }

      return {
        date,
        roles,
        employeeCount: employeeIds.size,
        count: roles.reduce((s, r) => s + r.count, 0),
        total: roles.reduce((s, r) => s + r.total, 0),
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
};

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

const AccrualRow = ({
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
  const meters = parseMeters(op.description);
  return (
    <div className="min-w-0 border-t border-border px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug">
            {accrualTypeLabels[op.type] || op.type}
            {op.orderNumber ? ` · #${op.orderNumber}` : ''}
          </p>
          {op.description ? (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{op.description}</p>
          ) : null}
          {formatAccrualShift(op) ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
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
        <span>#{op.id}</span>
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

/**
 * Начисления админа: «рабочий день → роль → сотрудник → строки».
 *
 * Сервер отдаёт дни целиком, роли — папки поверх: пошив отдельно от раскроя,
 * штрафы и ручные — в своих папках в конце дня.
 */
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
  const days = useMemo(() => groupByDayRoleEmployee(operations), [operations]);
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set());
  const [openRoles, setOpenRoles] = useState<Set<string>>(() => new Set());
  const [openPeople, setOpenPeople] = useState<Set<string>>(() => new Set());

  const dayKeyList = days.map((d) => d.date).join(',');
  const singleDay = days.length === 1 ? days[0].date : null;
  useEffect(() => {
    // Один день на странице — сразу раскрыт; одна роль в дне — тоже.
    setOpenDays(singleDay ? new Set([singleDay]) : new Set());
    if (singleDay) {
      const day = days.find((d) => d.date === singleDay);
      setOpenRoles(
        day && day.roles.length === 1
          ? new Set([`${singleDay}:${day.roles[0].key}`])
          : new Set(),
      );
    } else {
      setOpenRoles(new Set());
    }
    setOpenPeople(new Set());
    // days намеренно через dayKeyList: тот же набор дат → не сбрасывать раскрытие
    // при каждом новом массиве с тем же содержимым.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKeyList, singleDay]);

  const toggleDay = (date: string) => {
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const toggleRole = (key: string) => {
    setOpenRoles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const togglePerson = (key: string) => {
    setOpenPeople((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (loading && operations.length === 0) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (operations.length === 0) {
    return error ? null : (
      <p className="p-4 text-center text-sm text-muted-foreground">Начислений пока нет</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="divide-y divide-border">
          {days.map((day) => {
            const dayOpen = openDays.has(day.date);
            return (
              <div key={day.date} className="bg-card">
                <button
                  type="button"
                  onClick={() => toggleDay(day.date)}
                  className="flex w-full items-center gap-2 px-3 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <Icon
                    name="ChevronRight"
                    size={16}
                    className={`shrink-0 text-muted-foreground transition-transform ${
                      dayOpen ? 'rotate-90' : ''
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{formatDate(day.date)}</p>
                    <p className="text-xs text-muted-foreground">
                      {day.roles.length} {pluralRoles(day.roles.length)}
                      {' · '}
                      {day.employeeCount} {pluralPeople(day.employeeCount)}
                      {' · '}
                      {day.count} {pluralAccruals(day.count)}
                    </p>
                  </div>
                  <span className={`shrink-0 tabular-nums text-sm font-bold ${moneyTone(day.total)}`}>
                    {formatMoney(day.total)} ₽
                  </span>
                </button>

                {dayOpen && (
                  <div className="border-t border-border bg-muted/20">
                    {day.roles.map((role) => {
                      const roleKey = `${day.date}:${role.key}`;
                      const roleOpen = openRoles.has(roleKey);
                      return (
                        <div key={roleKey} className="border-b border-border last:border-b-0">
                          <button
                            type="button"
                            onClick={() => toggleRole(roleKey)}
                            className="flex w-full items-center gap-2 px-3 py-2.5 pl-6 text-left transition-colors hover:bg-muted/40"
                          >
                            <Icon
                              name="Folder"
                              size={14}
                              className={`shrink-0 transition-colors ${
                                roleOpen ? 'text-amber-600' : 'text-muted-foreground'
                              }`}
                            />
                            <Icon
                              name="ChevronRight"
                              size={14}
                              className={`shrink-0 text-muted-foreground transition-transform ${
                                roleOpen ? 'rotate-90' : ''
                              }`}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold">{role.label}</p>
                              <p className="text-xs text-muted-foreground">
                                {role.employees.length} {pluralPeople(role.employees.length)}
                                {' · '}
                                {role.count} {pluralAccruals(role.count)}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 tabular-nums text-sm font-semibold ${moneyTone(role.total)}`}
                            >
                              {formatMoney(role.total)} ₽
                            </span>
                          </button>

                          {roleOpen && (
                            <div className="bg-muted/10">
                              {role.employees.map((emp) => {
                                const personKey = `${roleKey}:${emp.userId}`;
                                const personOpen = openPeople.has(personKey);
                                return (
                                  <div
                                    key={personKey}
                                    className="border-t border-border"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => togglePerson(personKey)}
                                      className="flex w-full items-center gap-2 px-3 py-2.5 pl-12 text-left transition-colors hover:bg-muted/40"
                                    >
                                      <Icon
                                        name="ChevronRight"
                                        size={14}
                                        className={`shrink-0 text-muted-foreground transition-transform ${
                                          personOpen ? 'rotate-90' : ''
                                        }`}
                                      />
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-sm font-medium">
                                          {emp.userName}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          {emp.items.length} {pluralAccruals(emp.items.length)}
                                          {emp.unpaid > 0
                                            ? ` · не выплачено ${emp.unpaid}`
                                            : ''}
                                        </p>
                                      </div>
                                      <span
                                        className={`shrink-0 tabular-nums text-sm font-semibold ${moneyTone(emp.total)}`}
                                      >
                                        {formatMoney(emp.total)} ₽
                                      </span>
                                    </button>

                                    {personOpen && (
                                      <div className="bg-background">
                                        {emp.items.map((op) => (
                                          <AccrualRow
                                            key={op.id}
                                            op={op}
                                            savingAccrual={savingAccrual}
                                            onEdit={onEdit}
                                            onDelete={onDelete}
                                            onReload={onReload}
                                          />
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
                <span className="ml-1 text-xs">(по дням)</span>
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
