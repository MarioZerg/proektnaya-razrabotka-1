import { RefObject } from 'react';
import Icon from '@/components/ui/icon';

interface KioskScanLoginProps {
  workshopId: string | undefined;
  loading: boolean;
  code: string;
  setCode: (value: string) => void;
  onLogin: () => void;
  inputRef: RefObject<HTMLInputElement>;
}

/** Стартовый экран терминала: ждём скан персонального QR-кода сотрудника с бейджа.
 * Поле ввода скрыто — сканер печатает в него незаметно для сотрудника. */
const KioskScanLogin = ({
  workshopId,
  loading,
  code,
  setCode,
  onLogin,
  inputRef,
}: KioskScanLoginProps) => {
  return (
    <div className="kiosk-root flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl space-y-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold">Цех №{workshopId}</h1>
        </div>

        <div className="flex flex-col items-center gap-6 py-6">
          <Icon
            name={loading ? 'Loader2' : 'ScanLine'}
            size={72}
            className={`text-muted-foreground ${loading ? 'animate-spin' : ''}`}
          />
          <p className="text-center text-2xl font-semibold">
            {loading ? 'Проверяем код…' : 'Отсканируйте свой QR-код сотрудника'}
          </p>
          {/* Поле ввода скрыто: сканер печатает в него незаметно для сотрудника. */}
          <input
            ref={inputRef}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onLogin()}
            onBlur={() => setTimeout(() => inputRef.current?.focus(), 50)}
            className="pointer-events-none absolute h-px w-px border-0 p-0 opacity-0"
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>
      </div>
    </div>
  );
};

export default KioskScanLogin;
