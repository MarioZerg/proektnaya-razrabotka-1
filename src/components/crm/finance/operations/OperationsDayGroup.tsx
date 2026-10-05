import Icon from '@/components/ui/icon';
import { formatDate, formatMoney } from '@/components/crm/finance/financeShared';
import AccrualRow, { type AccrualActionsProps } from '@/components/crm/finance/operations/AccrualRow';
import {
  moneyTone,
  pluralAccruals,
  pluralPeople,
  pluralRoles,
  type DayGroup,
} from '@/components/crm/finance/operations/operationsGrouping';

interface OperationsDayGroupProps extends AccrualActionsProps {
  day: DayGroup;
  openDays: Set<string>;
  openRoles: Set<string>;
  openPeople: Set<string>;
  toggleDay: (date: string) => void;
  toggleRole: (key: string) => void;
  togglePerson: (key: string) => void;
}

/** Один рабочий день: шапка дня → папки ролей → сотрудники → строки начислений. */
const OperationsDayGroup = ({
  day,
  openDays,
  openRoles,
  openPeople,
  toggleDay,
  toggleRole,
  togglePerson,
  savingAccrual,
  onEdit,
  onDelete,
  onReload,
}: OperationsDayGroupProps) => {
  const dayOpen = openDays.has(day.date);
  return (
    <div className="bg-card">
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
};

export default OperationsDayGroup;
