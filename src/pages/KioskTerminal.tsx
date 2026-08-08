import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { kioskLoginByCode, type KioskUser, type KioskShift } from '@/lib/kioskApi';
import {
  openShift,
  closeShift,
  fetchEmployeeShifts,
  checkShiftDefects,
  type DefectCheck,
} from '@/lib/shiftSessionsApi';
import {
  playScanSound,
  playScanErrorSound,
  playShiftOpenSound,
  playShiftCloseSound,
} from '@/lib/scanSound';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import { type KioskScreen } from '@/components/crm/kiosk/KioskMenu';
import KioskScanLogin from '@/components/crm/kiosk/KioskScanLogin';
import KioskShiftGate from '@/components/crm/kiosk/KioskShiftGate';
import KioskWorkspace from '@/components/crm/kiosk/KioskWorkspace';

/** Терминал цеха (киоск). Полноэкранный экран для планшета в цехе: сотрудник входит
 * сканированием личного QR-кода с бейджа (формат "{id}-{смена}-{дата}"), пароль не нужен.
 * Номер цеха берётся из адреса: /kiosk/1 — терминал первого цеха. */
const KioskTerminal = () => {
  const { workshopId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<KioskUser | null>(null);
  const [shift, setShift] = useState<KioskShift | null>(null);
  const [shiftSaving, setShiftSaving] = useState(false);
  const [defectCheck, setDefectCheck] = useState<DefectCheck | null>(null);
  // Смену не дали закрыть из-за незавершённых заказов — показываем это крупно на экране,
  // а не всплывашкой: на планшете в цеху её легко пропустить.
  const [closeBlocked, setCloseBlocked] = useState<string>('');
  const [screen, setScreen] = useState<KioskScreen>('menu');
  // После скана QR сотрудник сначала попадает на экран смены и только потом, нажав
  // «Войти в терминал», переходит в меню с плитками.
  const [enteredMenu, setEnteredMenu] = useState(false);
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
        setShift(data.shift);
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
    [toast]
  );

  // Значение читаем прямо из поля: сканер вводит длинную строку очень быстро и может нажать
  // Enter раньше, чем React успеет положить последние символы в состояние — из состояния
  // тогда ушёл бы обрывок кода.
  const handleLogin = () => loginWithCode((inputRef.current?.value || code).trim());

  // Режим проверки для администратора: /kiosk/1?preview=1&role=sewer&name=Иван. Терминал
  // открывается глазами выбранной должности без сканирования QR и без открытия смены —
  // ничего не пишется в отчёты, админ просто смотрит, что видит сотрудник.
  const isPreview = searchParams.get('preview') === '1';
  useEffect(() => {
    if (!isPreview || user) return;
    const previewRole = searchParams.get('role') || 'sewer';
    const previewName = searchParams.get('name') || 'Проверка';
    // userId задан — админ смотрит терминал глазами конкретного сотрудника: экраны получат
    // его id, поэтому заказы, рулоны и смена будут настоящими, как у него на планшете.
    const previewUserId = Number(searchParams.get('userId')) || 0;
    setUser({
      id: previewUserId,
      name: previewName,
      role: previewRole,
      shiftFromCode: null,
      homeWorkshopId: Number(workshopId) || null,
    });
    setEnteredMenu(true);
    if (previewUserId) {
      // Подтягиваем настоящую смену сотрудника, чтобы админ видел терминал в том же
      // состоянии, что и работник: открыта смена или нет, какой цех и номер смены.
      fetchEmployeeShifts()
        .then((list) => {
          const found = list.find((e) => e.id === previewUserId);
          setShift({
            isOpen: !!found?.isOpen,
            openedAt: found?.openedAt ?? null,
            workshopId: found?.sessionWorkshopId ?? null,
            shiftNumber: found?.sessionShiftNumber ?? found?.shiftNumber ?? null,
          });
        })
        .catch(() =>
          setShift({ isOpen: false, openedAt: null, workshopId: null, shiftNumber: null }),
        );
    } else {
      setShift({ isOpen: false, openedAt: null, workshopId: null, shiftNumber: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview, user]);

  // Вход по ссылке из персонального QR сотрудника: /kiosk/1?barcode=3-20-20250513
  useEffect(() => {
    const barcode = searchParams.get('barcode');
    if (barcode && !user && !loading) {
      loginWithCode(barcode.trim());
      searchParams.delete('barcode');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Пауза больше обычной: из QR приходит длинная ссылка, ей нужно чуть больше времени,
  // чтобы сканер успел ввести её целиком до автоотправки.
  useScannerAutoSubmit(code, handleLogin, !loading && !user, 400);

  useEffect(() => {
    inputRef.current?.focus();
  }, [user]);

  const handleLogout = () => {
    setUser(null);
    setShift(null);
    setScreen('menu');
    setEnteredMenu(false);
    setCode('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Открытие/закрытие смены прямо на терминале. Цех и смену сотрудник выбирает на экране
  // входа: производственные роли работают гибко и могут выйти в чужой цех как гости.
  // По умолчанию подставлен цех этого терминала, поэтому в обычный день выбирать нечего.
  const handleOpenShift = async (
    chosenWorkshopId: number | null,
    chosenShiftNumber: number | null
  ) => {
    if (!user) return;
    // В режиме проверки смену не открываем: админ смотрит терминал, а не работает за него.
    if (isPreview) {
      toast({ title: 'Режим проверки', description: 'Смена не открывается — это только просмотр' });
      return;
    }
    setShiftSaving(true);
    try {
      const res = await openShift(
        user.id,
        chosenWorkshopId ?? Number(workshopId) ?? null,
        chosenShiftNumber ?? user.shiftFromCode ?? null
      );
      playShiftOpenSound();
      setShift({
        isOpen: true,
        openedAt: res.openedAt,
        workshopId: res.workshopId,
        shiftNumber: res.shiftNumber,
      });
      toast({
        title: 'Смена открыта',
        description: res.isLate ? 'Отмечено опоздание' : `Смена №${res.shiftNumber ?? '—'}`,
      });
    } catch (e) {
      playScanErrorSound();
      toast({
        title: 'Не удалось открыть смену',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setShiftSaving(false);
    }
  };

  // Сотрудник пришёл работать в чужой цех: списание брака здесь ему запрещено — это делает
  // штатный работник цеха, отсканировав свой штрихкод.
  const currentWorkshopId = shift?.workshopId ?? (Number(workshopId) || null);
  const isGuestInWorkshop = !!(
    user?.homeWorkshopId &&
    currentWorkshopId &&
    user.homeWorkshopId !== currentWorkshopId
  );

  // Перед закрытием смены напоминаем про брак: если сотрудник за смену не оформил ни одной
  // записи, скорее всего он про это забыл. Спрашиваем один раз — закрыть смену не мешаем.
  const handleCloseShiftClick = async () => {
    if (!user || isPreview) {
      handleCloseShift();
      return;
    }
    const check = await checkShiftDefects(user.id).catch(() => null);
    if (check) {
      setDefectCheck(check);
      return;
    }
    handleCloseShift();
  };

  const handleCloseShift = async () => {
    if (!user) return;
    setDefectCheck(null);
    if (isPreview) {
      toast({ title: 'Режим проверки', description: 'Смена не закрывается — это только просмотр' });
      return;
    }
    setShiftSaving(true);
    try {
      await closeShift(user.id);
      playShiftCloseSound();
      setShift({ isOpen: false, openedAt: null, workshopId: null, shiftNumber: null });
      // Смена закрыта — возвращаем сотрудника на стартовый экран терминала.
      setEnteredMenu(false);
      setScreen('menu');
      toast({ title: 'Смена закрыта' });
    } catch (e) {
      playScanErrorSound();
      const message = e instanceof Error ? e.message : 'Попробуйте ещё раз';
      if (message.includes('заказ')) {
        setCloseBlocked(message);
      } else {
        toast({ title: 'Не удалось закрыть смену', description: message, variant: 'destructive' });
      }
    } finally {
      setShiftSaving(false);
    }
  };

  // Первый экран после скана QR: открытие смены. В меню терминала пускаем только после того,
  // как сотрудник открыл смену и нажал «Войти в терминал».
  if (user && !enteredMenu) {
    return (
      <KioskShiftGate
        user={user}
        shift={shift}
        workshopId={workshopId}
        shiftSaving={shiftSaving}
        onEnterMenu={() => setEnteredMenu(true)}
        onOpenShift={handleOpenShift}
        onLogout={handleLogout}
      />
    );
  }

  // После входа сотрудник попадает в меню терминала с крупными плитками.
  if (user) {
    return (
      <KioskWorkspace
        user={user}
        shift={shift}
        workshopId={workshopId}
        currentWorkshopId={currentWorkshopId}
        isGuestInWorkshop={isGuestInWorkshop}
        isPreview={isPreview}
        screen={screen}
        setScreen={setScreen}
        shiftSaving={shiftSaving}
        defectCheck={defectCheck}
        setDefectCheck={setDefectCheck}
        closeBlocked={closeBlocked}
        onDismissCloseBlocked={() => setCloseBlocked('')}
        onLogout={handleLogout}
        onOpenShift={handleOpenShift}
        onCloseShift={handleCloseShift}
        onCloseShiftClick={handleCloseShiftClick}
      />
    );
  }

  return (
    <KioskScanLogin
      workshopId={workshopId}
      loading={loading}
      code={code}
      setCode={setCode}
      onLogin={handleLogin}
      inputRef={inputRef}
    />
  );
};

export default KioskTerminal;