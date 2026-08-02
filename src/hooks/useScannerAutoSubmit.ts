import { useEffect, useRef } from 'react';

/**
 * Хук авто-отправки для полей сканирования штрихкода/номера. Физический сканер штрихкодов
 * вводит все символы почти мгновенно одной пачкой и затем перестаёт что-либо печатать —
 * в отличие от человека, который вводит текст медленнее и с паузами между символами.
 * После каждого изменения значения поля запускаем короткий таймер; если за это время не
 * пришло новых символов — считаем ввод завершённым (конец сканирования) и автоматически
 * вызываем onSubmit, эмулируя нажатие Enter/клик по кнопке "Добавить".
 *
 * @param value    текущее значение поля ввода
 * @param onSubmit колбэк отправки (например, сканирование штрихкода)
 * @param enabled  можно временно отключить (например, пока идёт запрос)
 */
export function useScannerAutoSubmit(value: string, onSubmit: () => void, enabled = true) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!enabled || !value.trim()) return;

    timerRef.current = setTimeout(() => {
      onSubmitRef.current();
    }, 200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, enabled]);
}