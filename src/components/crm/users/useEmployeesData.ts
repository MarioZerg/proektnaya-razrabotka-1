import { useEffect, useState } from 'react';
import { fetchEmployees, type Employee } from '@/lib/usersApi';

/**
 * Список сотрудников: загрузка, вкладки «Работают»/«Архив», поиск и фильтры.
 *
 * Выборку держим здесь, а не в странице: правило «пока идёт поиск, фильтры не
 * сужают выборку» неочевидно, и его легко случайно сломать при правке разметки.
 */
export const useEmployeesData = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [workshopFilter, setWorkshopFilter] = useState<string>('all');

  // Работающие и уволенные — на разных вкладках. Архив открывают редко, поэтому
  // по умолчанию показываем тех, кто работает сейчас.
  const [tab, setTab] = useState<'active' | 'archived'>('active');

  const load = () => {
    setLoading(true);
    fetchEmployees()
      .then(setEmployees)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const q = search.trim().toLowerCase();

  const activeCount = employees.filter((e) => !e.archivedAt).length;
  const archivedCount = employees.filter((e) => e.archivedAt).length;

  const filtered = employees.filter((e) => {
    // Уволенные живут на своей вкладке и в рабочий список не попадают —
    // иначе они мешались бы в поиске и в фильтрах по цехам.
    if (tab === 'archived' ? !e.archivedAt : !!e.archivedAt) return false;
    // Пока в поиске что-то есть, фильтры по должности и цеху не сужают выборку:
    // администратор ищет КОНКРЕТНОГО человека и не должен гадать, в каком он цехе.
    if (q) {
      const haystack = [e.fullName, e.login, e.email, e.phone, e.workshop]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    }
    if (roleFilter !== 'all' && e.role !== roleFilter) return false;
    if (workshopFilter !== 'all' && (e.workshop || '') !== workshopFilter) return false;
    return true;
  });

  return {
    employees,
    setEmployees,
    loading,
    load,
    roleFilter,
    setRoleFilter,
    search,
    setSearch,
    workshopFilter,
    setWorkshopFilter,
    tab,
    setTab,
    activeCount,
    archivedCount,
    filtered,
  };
};
