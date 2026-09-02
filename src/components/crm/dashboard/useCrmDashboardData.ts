import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { fetchDashboardSummary, type DashboardSummary } from '@/lib/dashboardSummaryApi';
import { updateEmployee } from '@/lib/usersApi';
import {
  fetchEmployeeShifts,
  fetchShiftCalendar,
  fetchShiftsWithCalendar,
  openShift,
  closeShift,
  moveShiftToWorkshop,
  type EmployeeShiftStatus,
  type ShiftCalendarDay,
} from '@/lib/shiftSessionsApi';
import { fetchShifts, type ShiftListItem } from '@/lib/shiftsApi';
import { type DashboardWidgetData } from '@/components/crm/dashboard/dashboardShared';
import { isStorekeeperRole } from '@/lib/roles';
import { buildDashboardWidgets } from '@/components/crm/dashboard/crmDashboardWidgets';

/**
 * Данные главной страницы: права по ролям, сводка для плиток, смены и календарь.
 *
 * Вынесено из страницы 1:1 — те же запросы, тот же порядок эффектов и те же
 * зависимости. Смысл разделения в том, что разметка дашборда и загрузка данных
 * менялись по разным поводам и мешали друг другу в одном файле.
 */
export const useCrmDashboardData = () => {
  const { user, setActiveShift } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin';
  const isCleaner = user?.role === 'cleaner';
  const isCutter = user?.role === 'cutter';
  const isSewer = user?.role === 'sewer';
  const canSeeWarehouseWidgets = user?.role === 'admin' || isStorekeeperRole(user?.role);
  // Кладовщик и старший кладовщик: у них общее рабочее пространство склада.
  const isStorekeeper = isStorekeeperRole(user?.role);
  // Кладовщик и менеджер видят календарь-график смен (какие смены сегодня работают),
  // но без управления сменами сотрудников — это только для админа.
  const canSeeShiftCalendar = isAdmin || isStorekeeperRole(user?.role) || user?.role === 'manager';
  // Отгрузки FBO ведут склад и менеджер маркетплейса, администратор смотрит за всеми.
  const canSeeFboBoard = isAdmin || isStorekeeperRole(user?.role) || user?.role === 'manager';
  // Кто сегодня работает — управленческая информация. Производственным ролям (швея,
  // закройщик, упаковщица, уборщица) она не нужна и только загромождает их кабинет.
  const canSeeWorkingToday = canSeeShiftCalendar;

  const [dataLoading, setDataLoading] = useState(true);
  // Готовые цифры для плиток. Раньше здесь лежали ПОЛНЫЕ списки — все заказы,
  // весь склад, все рулоны — и панель считала плитки сама, перебирая тысячи
  // записей в браузере. Теперь считает база, а сюда приходит десяток чисел.
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  const [shiftsLoading, setShiftsLoading] = useState(true);
  const [employeeShifts, setEmployeeShifts] = useState<EmployeeShiftStatus[]>([]);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [allShifts, setAllShifts] = useState<ShiftListItem[]>([]);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [calendarDays, setCalendarDays] = useState<ShiftCalendarDay[]>([]);

  // Цифры для плиток: ОДИН запрос вместо пяти.
  //
  // Раньше панель выкачивала все заказы, весь товар на складе, все рулоны,
  // поставки и возвраты — около 4.5 МБ на каждое открытие — и считала плитки
  // прямо в браузере. Главную открывают все и держат открытой всю смену, так
  // что платили за это дважды: сервер собирал мегабайты, а планшет в цехе
  // потом их разбирал и подтормаживал. Теперь всё считает база, а сюда
  // приходит около килобайта готовых чисел.
  useEffect(() => {
    if (isCleaner) {
      setDataLoading(false);
      return;
    }
    setDataLoading(true);
    fetchDashboardSummary(user?.role, user?.id)
      .then(setSummary)
      .catch(() => {})
      .finally(() => setDataLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role, user?.id]);

  // Смены: у админа — список всех сотрудников, у остальных — только свой статус
  const loadShifts = () => {
    setShiftsLoading(true);
    fetchEmployeeShifts()
      .then(setEmployeeShifts)
      .finally(() => setShiftsLoading(false));
  };

  // Какой месяц календаря уже лежит в памяти. Нужен, чтобы не запрашивать заново
  // тот, что приехал вместе со статусами смен при открытии страницы.
  const loadedCalendarMonth = useRef<string | null>(null);

  useEffect(() => {
    if (isCleaner) {
      setShiftsLoading(false);
      return;
    }

    // Статусы смен и календарь — ОДНИМ запросом вместо двух к одной и той же
    // функции. Смена начинается тем, что все разом открывают главную, и база от
    // такого залпа отказывала: часть людей видела пустой экран вместо смен.
    const month =
      canSeeShiftCalendar && selectedDate ? format(selectedDate, 'yyyy-MM') : undefined;

    setShiftsLoading(true);
    fetchShiftsWithCalendar(month)
      .then(({ employees, days }) => {
        setEmployeeShifts(employees);
        if (month) {
          setCalendarDays(days);
          loadedCalendarMonth.current = month;
        }
      })
      .finally(() => setShiftsLoading(false));

    if (isAdmin) fetchShifts().then(setAllShifts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  // Человек листает календарь на другой месяц — доносим только его.
  // Месяц, приехавший вместе со статусами выше, повторно не запрашиваем.
  useEffect(() => {
    if (!canSeeShiftCalendar || !selectedDate) return;
    const month = format(selectedDate, 'yyyy-MM');
    if (loadedCalendarMonth.current === month) return;
    loadedCalendarMonth.current = month;
    fetchShiftCalendar(month).then(setCalendarDays);
  }, [canSeeShiftCalendar, selectedDate]);

  const myShiftStatus = useMemo(
    () => employeeShifts.find((e) => e.id === user?.id) || null,
    [employeeShifts, user?.id]
  );

  // Синхронизируем AuthContext с фактическим цехом/сменой уже открытой сессии — важно
  // после перезагрузки страницы, когда смена была открыта раньше (в т.ч. гостем).
  useEffect(() => {
    if (myShiftStatus?.isOpen) {
      setActiveShift(myShiftStatus.sessionWorkshopId, myShiftStatus.sessionShiftNumber);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myShiftStatus?.isOpen, myShiftStatus?.sessionWorkshopId, myShiftStatus?.sessionShiftNumber]);

  const handleToggleShift = async (employee: EmployeeShiftStatus) => {
    setTogglingId(employee.id);
    try {
      if (employee.isOpen) {
        // Администратор закрывает смену принудительно: у швеи/закройщика могут висеть
        // заказы, но админ как раз и разбирается с такими случаями вручную.
        await closeShift(employee.id, true, user?.id);
      } else {
        // Администратор открывает смену ЗА сотрудника с дашборда — штраф за опоздание
        // не начисляется (сотрудник не виноват, что за него открыл админ).
        await openShift(employee.id, undefined, undefined, true);
      }
      loadShifts();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setTogglingId(null);
    }
  };

  // Админ постоянно переключает штатную смену сотрудника (users.workshop/shiftNumber) —
  // сотрудник теперь официально числится в новой смене, пока его не переключат снова.
  const handleSwitchShift = async (employeeId: number, shiftId: number) => {
    const shift = allShifts.find((s) => s.id === shiftId);
    if (!shift) return;
    try {
      // Меняем ШТАТНУЮ смену в профиле — она действует со следующего открытия.
      await updateEmployee(employeeId, { workshop: shift.workshopName, shiftNumber: shift.shiftNumber });

      // И, если смена уже открыта, переносим ТЕКУЩУЮ смену в этот же цех. Без этого
      // перевод не давал никакого эффекта прямо сейчас: очередь заказов и материал
      // берутся из цеха открытой смены, и человек продолжал видеть пустой список.
      const emp = employeeShifts.find((e) => e.id === employeeId);
      let movedNow = false;
      if (emp?.isOpen && shift.workshopId) {
        const res = await moveShiftToWorkshop(employeeId, shift.workshopId);
        movedNow = !!res.moved;
      }
      toast({
        title: 'Смена сотрудника переключена',
        description: movedNow
          ? `Текущая смена перенесена в ${shift.workshopName} — заказы этого цеха уже доступны`
          : 'Начнёт действовать со следующего открытия смены',
      });
      loadShifts();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  // Админ включает/выключает сотруднику "свободный график" (гостевой режим) — не меняет
  // штатную смену в профиле, только снимает жёсткую привязку на будущие открытия смены.
  const handleToggleFree = async (employeeId: number, shiftFree: boolean) => {
    try {
      await updateEmployee(employeeId, { shiftFree });
      toast({ title: shiftFree ? 'Смена сотруднику выключена' : 'Сотрудник возвращён в свою смену' });
      loadShifts();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  const widgets: DashboardWidgetData[] = useMemo(
    () =>
      buildDashboardWidgets({
        isCleaner,
        isCutter,
        isSewer,
        canSeeWarehouseWidgets,
        summary,
      }),
    [isCleaner, isCutter, isSewer, canSeeWarehouseWidgets, summary]
  );

  return {
    user,
    isAdmin,
    isCutter,
    isSewer,
    isStorekeeper,
    canSeeShiftCalendar,
    canSeeFboBoard,
    canSeeWorkingToday,
    dataLoading,
    shiftsLoading,
    employeeShifts,
    togglingId,
    allShifts,
    selectedDate,
    setSelectedDate,
    calendarDays,
    myShiftStatus,
    widgets,
    handleToggleShift,
    handleSwitchShift,
    handleToggleFree,
  };
};

export default useCrmDashboardData;
