import { forwardRef } from 'react';

interface Props {
  code: string;
  setCode: (v: string) => void;
  /** Стикер напечатан, но заказ не закрыт — новый заказ не ищем. */
  unfinished: boolean;
  onSearch: () => void;
  onBlocked: () => void;
  /** Вернуть фокус: сканер печатает в это поле и терять его нельзя. */
  refocus: () => void;
}

/**
 * Скрытое поле ввода: сканер печатает в него незаметно для сотрудника.
 *
 * Фокус возвращается сам после любого касания экрана — иначе сканер «стреляет»
 * мимо поля, и терминал молча не отвечает на скан.
 */
const KioskScannerInput = forwardRef<HTMLInputElement, Props>(
  ({ code, setCode, unfinished, onSearch, onBlocked, refocus }, ref) => (
    <input
      ref={ref}
      autoFocus
      value={code}
      onChange={(e) => setCode(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return;
        // Скан пришёл в скрытое поле, а текущий заказ ещё не закрыт — новый
        // не ищем. Это основной путь сканера, поэтому предупреждение должно
        // сработать и здесь, а не только у глобального перехватчика.
        if (unfinished) {
          onBlocked();
          return;
        }
        onSearch();
      }}
      onBlur={() => setTimeout(refocus, 50)}
      className="pointer-events-none absolute h-px w-px border-0 p-0 opacity-0"
      aria-hidden="true"
      tabIndex={-1}
    />
  ),
);

KioskScannerInput.displayName = 'KioskScannerInput';

export default KioskScannerInput;
