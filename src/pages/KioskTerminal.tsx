import { useEffect, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { type KioskUser, type KioskShift } from '@/lib/kioskApi';
import { type DefectCheck } from '@/lib/shiftSessionsApi';
import { type KioskScreen } from '@/components/crm/kiosk/KioskMenu';
import KioskScanLogin from '@/components/crm/kiosk/KioskScanLogin';
import KioskShiftGate from '@/components/crm/kiosk/KioskShiftGate';
import KioskWorkspace from '@/components/crm/kiosk/KioskWorkspace';
import { useKioskLogin } from '@/components/crm/kiosk/useKioskLogin';
import { useKioskShift } from '@/components/crm/kiosk/useKioskShift';
import { useKioskPreview } from '@/components/crm/kiosk/useKioskPreview';
import WorkedDayOverlay from '@/components/crm/finance/WorkedDayOverlay';
import type { WorkedDay } from '@/components/crm/finance/workedDay';

/** Терминал цеха (киоск). Полноэкранный экран для планшета в цехе: сотрудник входит
 * сканированием личного QR-кода с бейджа (формат "{id}-{смена}-{дата}"), пароль не нужен.
 * Номер цеха берётся из адреса: /kiosk/1 — терминал первого цеха. */
const KioskTerminal = () => {
  const { workshopId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  // Режим проверки для администратора: /kiosk/1?preview=1&role=sewer&name=Иван. Терминал
  // открывается глазами выбранной должности без сканирования QR и без открытия смены —
  // ничего не пишется в отчёты, админ просто смотрит, что видит сотрудник.
  const isPreview = searchParams.get('preview') === '1';

  const [user, setUser] = useState<KioskUser | null>(null);
  const [shift, setShift] = useState<KioskShift | null>(null);
  const [defectCheck, setDefectCheck] = useState<DefectCheck | null>(null);
  // Смену не дали закрыть из-за незавершённых заказов — показываем это крупно на экране,
  // а не всплывашкой: на планшете в цеху её легко пропустить.
  const [closeBlocked, setCloseBlocked] = useState<string>('');
  // Опоздание показываем во весь экран сразу после открытия смены.
  const [lateInfo, setLateInfo] = useState<{
    minutes: number;
    penalty: number;
    start: string | null;
  } | null>(null);
  const [screen, setScreen] = useState<KioskScreen>('menu');
  // После скана QR сотрудник сначала попадает на экран смены и только потом, нажав
  // «Войти в терминал», переходит в меню с плитками.
  const [enteredMenu, setEnteredMenu] = useState(false);
  const [closedDay, setClosedDay] = useState<WorkedDay | null>(null);
  // Закрытые цеха (№2, тестовый) из адреса больше не открываем.
  const [retiredKiosk, setRetiredKiosk] = useState(workshopId === '2');

  const { code, setCode, loading, inputRef, loginWithCode, handleLogin } = useKioskLogin({
    workshopId,
    isPreview,
    user,
    setUser,
    setShift,
    toast,
  });

  useKioskPreview({
    isPreview,
    user,
    setUser,
    setShift,
    setEnteredMenu,
    searchParams,
    workshopId,
  });

  useEffect(() => {
    if (!workshopId || workshopId === '1' || workshopId === '2') return;
    fetchWorkshops()
      .then((list) => {
        if (!list.some((w) => String(w.id) === workshopId)) {
          setRetiredKiosk(true);
        }
      })
      .catch(() => {
        // FRONTEND-ONLY: список цехов не дошёл — терминал не сворачиваем.
      });
  }, [workshopId]);
  useEffect(() => {
    const barcode = searchParams.get('barcode');
    if (barcode && !user && !loading) {
      loginWithCode(barcode.trim());
      searchParams.delete('barcode');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleLogout = () => {
    setUser(null);
    setShift(null);
    setScreen('menu');
    setEnteredMenu(false);
    setClosedDay(null);
    setCode('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const { shiftSaving, handleOpenShift, handleCloseShift, handleCloseShiftClick } = useKioskShift({
    user,
    workshopId,
    isPreview,
    setShift,
    setDefectCheck,
    setCloseBlocked,
    setLateInfo,
    setEnteredMenu,
    setScreen,
    toast,
    onClosedDay: setClosedDay,
  });

  if (retiredKiosk) {
    const q = searchParams.toString();
    return <Navigate to={q ? `/kiosk/1?${q}` : '/kiosk/1'} replace />;
  }

  // Сотрудник пришёл работать в чужой цех: списание брака здесь ему запрещено — это делает
  // штатный работник цеха, отсканировав свой штрихкод.
  const currentWorkshopId = shift?.workshopId ?? (Number(workshopId) || null);
  const isGuestInWorkshop = !!(
    user?.homeWorkshopId &&
    currentWorkshopId &&
    user.homeWorkshopId !== currentWorkshopId
  );

  const dayOverlay = closedDay ? (
    <WorkedDayOverlay day={closedDay} onDone={() => setClosedDay(null)} />
  ) : null;

  // Первый экран после скана QR: открытие смены. В меню терминала пускаем только после того,
  // как сотрудник открыл смену и нажал «Войти в терминал».
  if (user && !enteredMenu) {
    return (
      <>
        {dayOverlay}
        <KioskShiftGate
          user={user}
          shift={shift}
          workshopId={workshopId}
          shiftSaving={shiftSaving}
          onEnterMenu={() => setEnteredMenu(true)}
          onOpenShift={handleOpenShift}
          onLogout={handleLogout}
        />
      </>
    );
  }

  // После входа сотрудник попадает в меню терминала с крупными плитками.
  if (user) {
    return (
      <>
        {dayOverlay}
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
          lateInfo={lateInfo}
          onDismissLate={() => setLateInfo(null)}
          onDismissCloseBlocked={() => setCloseBlocked('')}
          onLogout={handleLogout}
          onOpenShift={handleOpenShift}
          onCloseShift={handleCloseShift}
          onCloseShiftClick={handleCloseShiftClick}
        />
      </>
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