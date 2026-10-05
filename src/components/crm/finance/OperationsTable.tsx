import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/icon';
import type { SalaryOperation } from '@/lib/salaryApi';
import { groupByDayRoleEmployee } from '@/components/crm/finance/operations/operationsGrouping';
import OperationsDayGroup from '@/components/crm/finance/operations/OperationsDayGroup';
import OperationsPagination from '@/components/crm/finance/operations/OperationsPagination';

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
          {days.map((day) => (
            <OperationsDayGroup
              key={day.date}
              day={day}
              openDays={openDays}
              openRoles={openRoles}
              openPeople={openPeople}
              toggleDay={toggleDay}
              toggleRole={toggleRole}
              togglePerson={togglePerson}
              savingAccrual={savingAccrual}
              onEdit={onEdit}
              onDelete={onDelete}
              onReload={onReload}
            />
          ))}
        </div>
      </div>

      {totalPages > 1 && (
        <OperationsPagination page={page} setPage={setPage} totalPages={totalPages} />
      )}
    </div>
  );
};

export default OperationsTable;
