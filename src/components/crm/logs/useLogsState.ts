import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchLogEvents,
  fetchLogSummary,
  fetchLogUsers,
  type LogEvent,
  type LogStage,
  type LogSummary,
} from '@/lib/logsApi';

const PAGE_SIZE = 50;

/** Локальная дата в формате YYYY-MM-DD (без сдвига часового пояса). */
const isoDate = (d: Date) => {
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 10);
};

const shiftDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return isoDate(d);
};

/**
 * Состояние журнала действий: фильтры, страницы и загрузка данных.
 *
 * Вынесено из страницы, чтобы разметка осталась читаемой: здесь только логика,
 * там — только то, как это выглядит.
 */
export const useLogsState = () => {
  const [items, setItems] = useState<LogEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<LogSummary | null>(null);
  const [users, setUsers] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const [stage, setStage] = useState<LogStage | ''>('');
  const [userId, setUserId] = useState<number | ''>('');
  const [search, setSearch] = useState('');
  // По умолчанию — сегодняшний день: журнал за всё время грузится долго и
  // отвечает на вопрос «что происходит прямо сейчас» хуже, чем срез за день.
  const [dateFrom, setDateFrom] = useState(isoDate(new Date()));
  const [dateTo, setDateTo] = useState(isoDate(new Date()));
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      stage: stage || undefined,
      userId: userId || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      search: search.trim() || undefined,
    }),
    [stage, userId, dateFrom, dateTo, search],
  );

  const load = useCallback(() => {
    setLoading(true);
    fetchLogEvents({ ...filters, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
    fetchLogSummary(filters).then(setSummary).catch(() => setSummary(null));
  }, [filters, page]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    fetchLogUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  // Любая смена фильтра возвращает на первую страницу: иначе легко остаться на
  // десятой странице пустого результата и решить, что записей нет вообще.
  useEffect(() => setPage(1), [stage, userId, dateFrom, dateTo, search]);

  const activeFiltersCount =
    (stage ? 1 : 0) + (userId ? 1 : 0) + (search.trim() ? 1 : 0);

  const setToday = () => {
    setDateFrom(isoDate(new Date()));
    setDateTo(isoDate(new Date()));
  };

  const setYesterday = () => {
    setDateFrom(shiftDays(-1));
    setDateTo(shiftDays(-1));
  };

  const setWeek = () => {
    setDateFrom(shiftDays(-6));
    setDateTo(isoDate(new Date()));
  };

  const resetFilters = () => {
    setStage('');
    setUserId('');
    setSearch('');
    setToday();
  };

  return {
    items,
    total,
    summary,
    users,
    loading,
    stage,
    setStage,
    userId,
    setUserId,
    search,
    setSearch,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    page,
    setPage,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    activeFiltersCount,
    setToday,
    setYesterday,
    setWeek,
    resetFilters,
    reload: load,
  };
};
