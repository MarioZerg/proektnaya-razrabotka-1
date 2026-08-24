import { useEffect, useState } from 'react';
import { type KioskScreen } from '@/components/crm/kiosk/KioskMenu';
import KioskIdleTimer from '@/components/crm/kiosk/KioskIdleTimer';
import KioskDefectCheckDialog from '@/components/crm/kiosk/KioskDefectCheckDialog';
import KioskWorkspaceAlerts from '@/components/crm/kiosk/KioskWorkspaceAlerts';
import KioskWorkspaceHeader from '@/components/crm/kiosk/KioskWorkspaceHeader';
import KioskScreenRouter from '@/components/crm/kiosk/KioskScreenRouter';
import { fetchRepackCount, type KioskUser, type KioskShift } from '@/lib/kioskApi';
import type { DefectCheck } from '@/lib/shiftSessionsApi';

interface KioskWorkspaceProps {
  user: KioskUser;
  shift: KioskShift | null;
  workshopId: string | undefined;
  currentWorkshopId: number | null;
  isGuestInWorkshop: boolean;
  isPreview: boolean;
  screen: KioskScreen;
  setScreen: (screen: KioskScreen) => void;
  shiftSaving: boolean;
  defectCheck: DefectCheck | null;
  setDefectCheck: (check: DefectCheck | null) => void;
  /** Сообщение о том, что смену нельзя закрыть из-за незавершённых заказов. */
  closeBlocked: string;
  onDismissCloseBlocked: () => void;
  /** Данные об опоздании — показываем во весь экран сразу после открытия смены. */
  lateInfo: { minutes: number; penalty: number; start: string | null } | null;
  onDismissLate: () => void;
  onLogout: () => void;
  /** Открыть смену. Внутри терминала цех и смена уже известны — передаём null,
   * и они берутся те же, что при входе. */
  onOpenShift: (workshopId: number | null, shiftNumber: number | null) => void;
  onCloseShift: () => void;
  onCloseShiftClick: () => void;
}

/** Рабочая область терминала после входа: шапка с данными сотрудника и содержимое
 * выбранного экрана — меню плиток, смена, заказы, рулоны, брак и остальные разделы. */
const KioskWorkspace = ({
  user,
  shift,
  workshopId,
  currentWorkshopId,
  isGuestInWorkshop,
  isPreview,
  screen,
  setScreen,
  shiftSaving,
  defectCheck,
  setDefectCheck,
  closeBlocked,
  onDismissCloseBlocked,
  lateInfo,
  onDismissLate,
  onLogout,
  onOpenShift,
  onCloseShift,
  onCloseShiftClick,
}: KioskWorkspaceProps) => {
  // Раз в полминуты сверяем текущее время с разрешённым: как только смена отработана,
  // кнопка закрытия включается сама — сотруднику не нужно перезаходить в терминал.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const closeAt = shift?.canCloseAt ? new Date(shift.canCloseAt) : null;
  const canCloseNow = !closeAt || now >= closeAt.getTime();

  // Сколько вещей ждёт перепаковки в этом цехе — число на плитке меню.
  //
  // Обновляем при каждом возврате в меню: упаковщица закрыла вещь и вернулась —
  // счётчик уже новый. Считаем только СВОЙ цех, иначе киоски цехов №1 и №2 покажут
  // одно и то же число и обе упаковщицы пойдут за одними вещами.
  const [repackCount, setRepackCount] = useState(0);
  const repackWorkshop = currentWorkshopId || Number(workshopId) || null;
  useEffect(() => {
    if (screen !== 'menu') return;
    let alive = true;
    fetchRepackCount(repackWorkshop).then((r) => {
      if (alive) setRepackCount(r.mineCount + r.freeCount);
    });
    return () => {
      alive = false;
    };
  }, [screen, repackWorkshop]);

  return (
    <div className="kiosk-root min-h-screen bg-background">
      {/* Автовыход из профиля при бездействии: предупреждение через минуту, отсчёт 30 сек.
          В режиме проверки таймер не нужен — админ может спокойно изучать экраны. */}
      {!isPreview && <KioskIdleTimer onTimeout={onLogout} />}

      <KioskWorkspaceAlerts
        lateInfo={lateInfo}
        onDismissLate={onDismissLate}
        closeBlocked={closeBlocked}
        onDismissCloseBlocked={onDismissCloseBlocked}
        onGoToOrders={() => {
          onDismissCloseBlocked();
          setScreen('orders');
        }}
      />

      {/* Напоминание про брак перед закрытием смены. Текст свой для каждой роли:
          закройщику про ткань, швее про тесьму — так вопрос попадает в её работу. */}
      {defectCheck && (
        <KioskDefectCheckDialog
          defectCheck={defectCheck}
          shiftSaving={shiftSaving}
          onGoToDefect={() => {
            setDefectCheck(null);
            setScreen('defect');
          }}
          onCloseShift={onCloseShift}
        />
      )}

      <KioskWorkspaceHeader
        user={user}
        shift={shift}
        workshopId={workshopId}
        isPreview={isPreview}
        screen={screen}
        setScreen={setScreen}
        onLogout={onLogout}
      />

      <KioskScreenRouter
        user={user}
        shift={shift}
        workshopId={workshopId}
        currentWorkshopId={currentWorkshopId}
        isGuestInWorkshop={isGuestInWorkshop}
        isPreview={isPreview}
        screen={screen}
        setScreen={setScreen}
        shiftSaving={shiftSaving}
        repackCount={repackCount}
        closeAt={closeAt}
        canCloseNow={canCloseNow}
        onOpenShift={onOpenShift}
        onCloseShiftClick={onCloseShiftClick}
      />
    </div>
  );
};

export default KioskWorkspace;
