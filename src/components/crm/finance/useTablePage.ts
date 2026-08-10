import { useEffect, useMemo, useState } from 'react';

/** Сколько строк показываем в таблицах финансов на одной странице. */
export const FINANCE_PAGE_SIZE = 15;

/**
 * Постраничный показ для таблиц, которые приходят с сервера целиком.
 *
 * Длинные списки (касса, выплаты, мои начисления) растягивали страницу на несколько
 * экранов. Режем их на страницы по 15 строк прямо в браузере — данные уже загружены,
 * лишних запросов не нужно.
 */
export const useTablePage = <T,>(items: T[], pageSize = FINANCE_PAGE_SIZE) => {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  // Список обновился и стал короче — возвращаемся на существующую страницу,
  // иначе таблица окажется пустой.
  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const visible = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize]
  );

  return { visible, page, setPage, totalPages, total: items.length };
};
