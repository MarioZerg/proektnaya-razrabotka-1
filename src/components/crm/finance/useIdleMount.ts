import { useEffect, useState } from 'react';

/**
 * Отложенный mount для тяжёлых блоков ниже первого экрана (тарифы).
 * Ждём первый paint / простой браузера, но не дольше `timeout` мс —
 * блок не откладывается «навечно».
 */
export const useIdleMount = (timeout = 300) => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setReady(true), { timeout });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setReady(true), 50);
    return () => window.clearTimeout(t);
  }, [timeout]);

  return ready;
};

export default useIdleMount;
