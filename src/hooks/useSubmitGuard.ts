import { useCallback, useRef, useState } from 'react';

/**
 * Блокирует повторный клик, пока запрос ещё идёт.
 *
 * `disabled={busy}` на кнопке опаздывает на один кадр: второй клик успевает
 * уйти до перерисовки. Ref закрывает эту щель — как при списании недостачи
 * на поставщика, когда человек жмёт ещё раз, не дождавшись исчезновения строки.
 */
export const useSubmitGuard = () => {
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      return await fn();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, run };
};

/** Тот же замок, но по id строки: остальные кнопки в списке остаются живыми. */
export const useIdSubmitGuard = () => {
  const locked = useRef(new Set<number>());
  const [busyId, setBusyId] = useState<number | null>(null);

  const run = useCallback(async (id: number, fn: () => Promise<void>) => {
    if (locked.current.has(id)) return;
    locked.current.add(id);
    setBusyId(id);
    try {
      await fn();
    } finally {
      locked.current.delete(id);
      setBusyId((cur) => (cur === id ? null : cur));
    }
  }, []);

  return { busyId, run };
};
