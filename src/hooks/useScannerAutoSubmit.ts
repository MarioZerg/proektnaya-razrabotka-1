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
  // Запоминаем значение, для которого уже была вызвана отправка. Это защита от зацикливания:
  // пока идёт запрос, enabled становится false, а после его завершения (успех или ошибка)
  // снова true — если само значение поля при этом не очистилось (например, обработчик забыл
  // это сделать при ошибке), то без этой проверки эффект перезапустился бы просто от смены
  // enabled и повторно отправил бы тот же самый код по кругу.
  const lastSubmittedRef = useRef<string | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!value.trim()) {
      lastSubmittedRef.current = null;
      return;
    }

    if (!enabled || lastSubmittedRef.current === value) return;

    timerRef.current = setTimeout(() => {
      lastSubmittedRef.current = value;
      onSubmitRef.current();
    }, 200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, enabled]);
}