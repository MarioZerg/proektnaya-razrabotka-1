import { useEffect } from 'react';
import type { KioskUser, KioskShift } from '@/lib/kioskApi';
import { fetchEmployeeShifts } from '@/lib/shiftSessionsApi';

interface Params {
  isPreview: boolean;
  user: KioskUser | null;
  setUser: (u: KioskUser | null) => void;
  setShift: (s: KioskShift | null) => void;
  setEnteredMenu: (v: boolean) => void;
  searchParams: URLSearchParams;
  workshopId: string | undefined;
}

/**
 * Режим проверки для администратора: /kiosk/1?preview=1&role=sewer&name=Иван.
 *
 * Терминал открывается глазами выбранной должности без сканирования QR и без
 * открытия смены — ничего не пишется в отчёты, админ просто смотрит, что видит
 * сотрудник. Нужен, когда работник звонит с «у меня тут ничего не нажимается».
 */
export const useKioskPreview = ({
  isPreview,
  user,
  setUser,
  setShift,
  setEnteredMenu,
  searchParams,
  workshopId,
}: Params) => {
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
            canCloseAt: found?.canCloseAt ?? null,
          });
        })
        .catch(() =>
          setShift({ isOpen: false, openedAt: null, workshopId: null, shiftNumber: null, canCloseAt: null }),
        );
    } else {
      setShift({ isOpen: false, openedAt: null, workshopId: null, shiftNumber: null, canCloseAt: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview, user]);
};
