import { useEffect, useState } from 'react';
import { fetchPendingContracts } from '@/lib/contractsApi';
import { checkDocsExpired, fetchPersonalData } from '@/lib/personalDataApi';
import type { DocsStatus } from '@/lib/personalDataApi';

/**
 * Одна проверка доступа на весь сеанс работы.
 *
 * Раньше каждая из проверок жила в своём месте: неподписанные договоры — в каркасе,
 * просроченные документы — там же, счётчик срока — в плашке наверху. Итог: при
 * открытии ЛЮБОЙ страницы система слала три запроса подряд и только потом рисовала
 * интерфейс. Переход между разделами ощущался как «сайт грузится».
 *
 * Теперь проверка выполняется один раз за сеанс, результат лежит в памяти вкладки.
 * Переходы между страницами мгновенные: данные уже есть.
 */

export interface AccessState {
  /** Сколько документов ждут подписи. */
  pendingContracts: number;
  /** Доступ приостановлен: документы не сданы в срок. */
  docsBlocked: boolean;
  /** Состояние счётчика на загрузку документов. */
  docsStatus: DocsStatus | null;
  /** Причина, по которой админ отклонил документы. */
  docsRejectedReason: string | null;
  /** Проверка ещё идёт — интерфейс не запираем и не мигаем зря. */
  loading: boolean;
}

const EMPTY: AccessState = {
  pendingContracts: 0,
  docsBlocked: false,
  docsStatus: null,
  docsRejectedReason: null,
  loading: true,
};

// Кэш на вкладку: пока человек не перезагрузил страницу, проверка не повторяется.
let cache: { userId: number; state: AccessState } | null = null;
const subscribers = new Set<(s: AccessState) => void>();

const publish = (state: AccessState) => {
  if (cache) cache.state = state;
  subscribers.forEach((fn) => fn(state));
};

/** Сбрасывает кэш: вызывается после загрузки документов или подписания договора. */
export const refreshAccess = () => {
  cache = null;
};

export const useAccessGate = (userId: number | undefined, isAdmin: boolean) => {
  const [state, setState] = useState<AccessState>(
    () => (userId && cache?.userId === userId ? cache.state : EMPTY)
  );

  useEffect(() => {
    if (!userId) return;

    // Данные уже проверены в этом сеансе — показываем сразу, без запросов.
    if (cache?.userId === userId) {
      setState(cache.state);
      subscribers.add(setState);
      return () => void subscribers.delete(setState);
    }

    cache = { userId, state: EMPTY };
    subscribers.add(setState);

    // Все проверки разом, а не одна за другой: так ожидание равно самому
    // медленному запросу, а не их сумме.
    Promise.allSettled([
      fetchPendingContracts(userId),
      isAdmin ? Promise.resolve({ blocked: false }) : checkDocsExpired(userId),
      isAdmin ? Promise.resolve(null) : fetchPersonalData(userId, userId),
    ]).then(([contracts, expired, personal]) => {
      const next: AccessState = {
        pendingContracts:
          contracts.status === 'fulfilled' ? contracts.value : 0,
        docsBlocked:
          expired.status === 'fulfilled' ? Boolean(expired.value?.blocked) : false,
        docsStatus:
          personal.status === 'fulfilled' && personal.value
            ? personal.value.docsStatus
            : null,
        docsRejectedReason:
          personal.status === 'fulfilled' && personal.value
            ? personal.value.docsRejectedReason
            : null,
        loading: false,
      };
      publish(next);
    });

    return () => void subscribers.delete(setState);
  }, [userId, isAdmin]);

  return state;
};
