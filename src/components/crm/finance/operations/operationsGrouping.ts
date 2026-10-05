import type { SalaryOperation } from '@/lib/salaryApi';
import { roleLabels } from '@/lib/roles';
import { accrualTypeLabels } from '@/components/crm/finance/financeShared';

export type EmployeeGroup = {
  userId: number;
  userName: string;
  items: SalaryOperation[];
  total: number;
  unpaid: number;
};

export type RoleGroup = {
  key: string;
  label: string;
  order: number;
  employees: EmployeeGroup[];
  count: number;
  total: number;
};

export type DayGroup = {
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

export const amountClass = (op: SalaryOperation) =>
  op.type === 'penalty'
    ? 'text-destructive'
    : op.amount < 0
      ? 'text-amber-600'
      : 'text-emerald-600';

export const moneyTone = (n: number) =>
  n < 0 ? 'text-destructive' : n > 0 ? 'text-emerald-700' : 'text-muted-foreground';

export const pluralAccruals = (n: number) =>
  n === 1 ? 'начисление' : n < 5 ? 'начисления' : 'начислений';

export const pluralPeople = (n: number) =>
  n === 1 ? 'сотрудник' : n < 5 ? 'сотрудника' : 'сотрудников';

export const pluralRoles = (n: number) => (n === 1 ? 'роль' : n < 5 ? 'роли' : 'ролей');

/**
 * День → роль → сотрудники → строки.
 *
 * В цехе за день смешиваются швеи, закройщики и упаковщики. Без папки роли
 * список выглядит как мешок ФИО; с папкой сразу видно, сколько ушло на пошив
 * и сколько на раскрой, и внутри роли — кто сколько заработал.
 */
export const groupByDayRoleEmployee = (operations: SalaryOperation[]): DayGroup[] => {
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
