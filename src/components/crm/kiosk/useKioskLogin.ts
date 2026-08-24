import { useCallback, useEffect, useRef, useState } from 'react';
import { kioskLoginByCode, type KioskUser, type KioskShift } from '@/lib/kioskApi';
import { moveShiftToWorkshop } from '@/lib/shiftSessionsApi';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { useGlobalScanner } from '@/hooks/useGlobalScanner';

type Toast = (opts: {
  title: string;
  description?: string;
  variant?: 'default' | 'destructive';
}) => void;

interface Params {
  workshopId: string | undefined;
  isPreview: boolean;
  user: KioskUser | null;
  setUser: (u: KioskUser | null) => void;
  setShift: (s: KioskShift | null) => void;
  toast: Toast;
}

/**
 * Вход на терминал сканированием личного QR-кода сотрудника.
 *
 * Пароля нет: в цехе его вводить нечем и некогда — сотрудник подносит бейдж к
 * сканеру. Поэтому весь вход держится на разборе строки от сканера, и здесь же
 * лежат подстраховки: чужая раскладка, потеря фокуса, обрывок кода.
 */
export const useKioskLogin = ({
  workshopId,
  isPreview,
  user,
  setUser,
  setShift,
  toast,
}: Params) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Сканер может ввести чистый код (1-1-20260804) или всю ссылку из QR. Причём если на
  // терминале включена русская раскладка, латиница в ссылке превращается в кириллицу
  // ("barcode=" → "ифксцщву="), а цифры остаются целыми. Поэтому ищем в строке сам код по
  // шаблону "{id}-{смена}-{дата}" — это работает при любой раскладке и формате ввода.
  const extractCode = (raw: string): string => {
    const value = raw.trim();
    const byPattern = value.match(/(\d{1,6}-\d{1,3}-\d{6,8})/);
    if (byPattern) return byPattern[1];
    const byParam = value.match(/barcode=([^&\s]+)/i);
    if (byParam) return decodeURIComponent(byParam[1]);
    return value;
  };

  const loginWithCode = useCallback(
    async (rawValue: string) => {
      const value = extractCode(rawValue);
      if (!value) return;
      setCode('');
      if (inputRef.current) inputRef.current.value = '';
      setLoading(true);
      try {
        const data = await kioskLoginByCode(value);
        playScanSound();
        setUser(data.user);

        // Смена одна на весь рабочий день. Если сотрудник открыл её в своём цехе, а потом
        // пришёл работать сюда — переносим смену в этот цех, а не заставляем открывать
        // новую. Так заказы, лимиты и настройки берутся из того цеха, где он реально
        // стоит, а закрыть смену нужно один раз в конце дня.
        const terminalWorkshopId = Number(workshopId) || null;
        if (
          !isPreview &&
          data.shift?.isOpen &&
          terminalWorkshopId &&
          data.shift.workshopId &&
          data.shift.workshopId !== terminalWorkshopId
        ) {
          const moved = await moveShiftToWorkshop(data.user.id, terminalWorkshopId).catch(
            () => null
          );
          if (moved?.moved) {
            setShift({
              ...data.shift,
              workshopId: moved.workshopId ?? terminalWorkshopId,
              shiftNumber: moved.shiftNumber ?? data.shift.shiftNumber,
            });
            toast({
              title: 'Смена перенесена в этот цех',
              description: 'Открывать смену заново не нужно — закройте её в конце дня',
            });
          } else {
            setShift(data.shift);
          }
        } else {
          setShift(data.shift);
        }
      } catch (e) {
        playScanErrorSound();
        toast({
          title: 'Не удалось войти',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toast, workshopId, isPreview]
  );

  // Значение читаем прямо из поля: сканер вводит длинную строку очень быстро и может нажать
  // Enter раньше, чем React успеет положить последние символы в состояние — из состояния
  // тогда ушёл бы обрывок кода.
  const handleLogin = () => loginWithCode((inputRef.current?.value || code).trim());

  // Пауза больше обычной: из QR приходит длинная ссылка, ей нужно чуть больше времени,
  // чтобы сканер успел ввести её целиком до автоотправки.
  useScannerAutoSubmit(code, handleLogin, !loading && !user, 400);

  // Та же подстраховка, что и на стикеровке: если поле входа потеряло фокус, сканер
  // печатает мимо него и терминал не реагирует на QR сотрудника.
  useGlobalScanner((scanned) => loginWithCode(scanned), !loading && !user);

  useEffect(() => {
    inputRef.current?.focus();
  }, [user]);

  return { code, setCode, loading, inputRef, loginWithCode, handleLogin };
};
