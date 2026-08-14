import { useEffect, useRef } from 'react';

/**
 * Ловит ввод сканера штрихкодов на уровне всей страницы, независимо от фокуса.
 *
 * Раньше терминал полагался на скрытое поле ввода с автофокусом. Пока фокус в нём —
 * всё работает, но потерять его на планшете легко: всплывающее окно (напоминание о
 * смене, автовыход, тост), случайное касание экрана, возврат из спящего режима или
 * переключение вкладки. Фокус уходит — и сканер «печатает» в пустоту: сотрудник пикает
 * QR-код, а на терминале полная тишина, даже карточка заказа не появляется.
 *
 * Сканер отличается от человека скоростью: он выдаёт всю строку за миллисекунды и
 * завершает её Enter. Поэтому слушаем клавиатуру глобально и собираем символы, идущие
 * подряд без долгих пауз. Медленный набор руками при этом не мешает: пауза дольше
 * gapMs начинает строку заново.
 *
 * @param onScan   вызывается с распознанным кодом
 * @param enabled  выключать, пока идёт запрос или заказ уже открыт
 */
export function useGlobalScanner(
  onScan: (code: string) => void,
  enabled = true,
  { minLength = 4, gapMs = 120, endMs = 400 } = {},
) {
  const bufRef = useRef('');
  const lastKeyAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) {
      bufRef.current = '';
      return;
    }

    const flush = () => {
      const code = bufRef.current.trim();
      bufRef.current = '';
      if (code.length >= minLength) onScanRef.current(code);
    };

    const handler = (e: KeyboardEvent) => {
      // Не мешаем ручному вводу: если человек печатает в настоящее поле или textarea
      // (ручной поиск, комментарий к браку), сканер-перехватчик молчит.
      const el = e.target as HTMLElement | null;
      const tag = (el?.tagName || '').toLowerCase();
      const isRealField =
        (tag === 'input' && el?.getAttribute('aria-hidden') !== 'true') ||
        tag === 'textarea' ||
        el?.isContentEditable;
      if (isRealField) return;

      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const now = Date.now();
      // Долгая пауза — это новый скан, а не продолжение прошлого.
      if (now - lastKeyAtRef.current > gapMs) bufRef.current = '';
      lastKeyAtRef.current = now;

      if (timerRef.current) clearTimeout(timerRef.current);

      if (e.key === 'Enter') {
        flush();
        return;
      }
      // Берём только «печатные» одиночные символы: служебные клавиши (Shift, Tab,
      // стрелки) в штрихкод не входят.
      if (e.key.length === 1) {
        bufRef.current += e.key;
        // Сканер может не слать Enter в конце — тогда закрываем строку по паузе.
        timerRef.current = setTimeout(flush, endMs);
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, minLength, gapMs, endMs]);
}

export default useGlobalScanner;
