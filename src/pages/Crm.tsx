import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import CrmLayout from '@/components/crm/CrmLayout';
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
import DashboardWidgetsGrid from '@/components/crm/dashboard/DashboardWidgetsGrid';
import AdminNotifications from '@/components/crm/dashboard/AdminNotifications';
import VarikiPurchasesCard from '@/components/crm/variki/VarikiPurchasesCard';
import WorkingTodayCard from '@/components/crm/dashboard/WorkingTodayCard';
import ShiftManagementCard from '@/components/crm/dashboard/ShiftManagementCard';
import ShiftCalendarCard from '@/components/crm/dashboard/ShiftCalendarCard';
import MyShiftCard from '@/components/crm/dashboard/MyShiftCard';
import LototronCard from '@/components/crm/dashboard/LototronCard';
import ShortagePenaltyCard from '@/components/crm/dashboard/ShortagePenaltyCard';
import StaffEfficiencyCard from '@/components/crm/dashboard/StaffEfficiencyCard';
import FboShipmentsCard from '@/components/crm/dashboard/FboShipmentsCard';
import { type DashboardWidgetData } from '@/components/crm/dashboard/dashboardShared';
import { isStorekeeperRole } from '@/lib/roles';
import SewerBonusCard from '@/components/crm/dashboard/SewerBonusCard';
import SewerDailyCard from '@/components/crm/dashboard/SewerDailyCard';

const CrmDashboard = () => {
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

  const widgets: DashboardWidgetData[] = useMemo(() => {
    if (isCleaner) return [];
    if (!summary) return [];

    // Все цифры уже посчитаны базой по тем же правилам, что раньше применялись
    // здесь: швея и закройщик видят ТОЛЬКО свою работу (сервер получил роль и id
    // и отфильтровал), «Новые задания» и «Раскроено» — общая очередь на всех.
    const list: DashboardWidgetData[] = [
      { label: 'Новые задания на пошив', value: summary.newOrders, icon: 'ListPlus', tone: 'default', path: '/crm/marketplace/sewing-items', stage: 'production', hint: 'Заказы приняты и ждут, когда их возьмут в работу' },
      // Швее и закройщику подписываем «У меня», чтобы цифра не читалась как объём
      // всего цеха: у них в этих виджетах теперь только собственные заказы.
      { label: isSewer ? 'У меня в пошиве' : 'Товары в пошиве', value: summary.inSewing, icon: 'Shirt', tone: 'default', path: '/crm/marketplace/sewing-items', stage: 'production', hint: isSewer ? 'Вещи, которые вы шьёте прямо сейчас' : 'Вещи в работе у швей' },
      // Швее раскрой не показываем совсем: она его не делает и повлиять на него
      // не может — цифра только отвлекает от собственной работы.
      ...(isSewer
        ? []
        : [{ label: isCutter ? 'У меня в закрое' : 'Товары в закрое', value: summary.inCutting, icon: 'Scissors', tone: 'default' as const, path: '/crm/marketplace/sewing-items', stage: 'production' as const, hint: isCutter ? 'Ткань, которую вы кроите прямо сейчас' : 'Ткань в работе у закройщиков' }]),
      // ?type=FBS — страница откроется сразу с фильтром по FBS, иначе показывала все заказы
      // Срочные FBS — это работа цеха, а не отдельная тревога: их шьют в общем
      // потоке, просто в первую очередь. Поэтому плитка стоит в производстве,
      // первой в цепочке, и остаётся красной — приоритет никуда не делся.
      { label: 'Срочные заказы (FBS)', value: summary.urgentFbs, icon: 'Zap', tone: 'urgent', path: '/crm/marketplace/sewing-items?type=FBS', stage: 'production', hint: 'Отгрузка сегодня — делать в первую очередь' },
      { label: 'Не отгруженные поставки в цех', value: summary.notShippedToWorkshop, icon: 'TruckElectric', tone: 'warning', path: '/crm/shipments/to-workshop', stage: 'warehouse', hint: 'Материал собран, но со склада ещё не уехал' },
      { label: 'Не принятые поставки в цехе', value: summary.notReceivedInWorkshop, icon: 'PackageX', tone: 'warning', path: '/crm/shipments/to-workshop', stage: 'warehouse', hint: 'Привезли в цех, но приёмку никто не подтвердил' },
      { label: isSewer || isCutter ? 'Мои на стикеровке' : 'Товары на стикеровке', value: summary.inStickering, icon: 'Tag', tone: 'default', path: '/crm/marketplace/sewing-items', stage: 'production', hint: 'Сшито и ждёт наклейки стикера маркетплейса' },
      // «Раскроено» — тоже не для швеи: это итог работы закройщиков, а очередь,
      // из которой швея берёт вещи, у неё в «Новых заданиях».
      ...(isSewer
        ? []
        : [{ label: 'Раскроено', value: summary.cut, icon: 'CheckCircle2', tone: 'default' as const, path: '/crm/marketplace/sewing-items', stage: 'production' as const, hint: 'Крой готов и передан швеям' }]),
    ];

    if (canSeeWarehouseWidgets) {
      const awaitingShelf = summary.awaitingShelf || 0;
      const awaitingShipLabel = summary.awaitingShipLabel || 0;
      const returnsPickedUp = summary.returnsPickedUp || 0;
      // Виджета «Товары к подбору со склада» больше нет: он показывал ВЕСЬ товар на
      // полках (сотни штук) и выглядел как гора работы, хотя это просто остаток.
      // Реальная задача кладовщика — вещи, подобранные под заказы: их и показываем
      // строкой «Заказы с полок».
      list.splice(4, 0, {
        label: 'Отменено — забрать из цеха на полку',
        value: awaitingShelf,
        icon: 'PackageCheck',
        tone: awaitingShelf > 0 ? 'urgent' : 'default',
        path: '/crm/inventory/goods-warehouse',
        stage: 'warehouse',
        hint: 'Заказ отменили — вещь надо вернуть из цеха на полку',
      });
      list.splice(5, 0, {
        label: 'Собрать с полок под заказы',
        value: awaitingShipLabel,
        icon: 'PackageSearch',
        tone: awaitingShipLabel > 0 ? 'urgent' : 'default',
        // Ведём сразу на сборку, а не на общий склад: кладовщику нужно
        // отсканировать вещь и напечатать стикер, а не смотреть остатки.
        path: '/crm/inventory/goods-picking',
        stage: 'warehouse',
        hint: 'Отсканировать вещь и напечатать стикер отправления',
      });
      // Вещи привезли с ПВЗ, но кладовщик их ещё не осмотрел. Пока они не лежат
      // на полке, товар считается непроверенным и в подбор не идёт.
      // Обе плитки ведут на склад товара: там кладовщик и принимает привезённое
      // с ПВЗ, и разбирает его. Страница «Приём возвратов» ему не нужна — на ней
      // видно всё движение возврата и принимаются решения по нему, а это работа
      // руководителя.
      list.push({
        label: 'Возвраты с ПВЗ — разобрать',
        value: returnsPickedUp,
        icon: 'PackageOpen',
        tone: returnsPickedUp > 0 ? 'urgent' : 'default',
        path: '/crm/inventory/goods-warehouse',
        stage: 'warehouse',
        hint: 'Привезли с пункта выдачи — осмотреть и разложить',
      });
      // Виджет «Возвраты — принять на склад» убран: он считал ВСЕ возвраты,
      // заведённые маркетплейсом (больше полутора тысяч за всё время), включая те,
      // которые кладовщик в глаза не видел и которые могут никогда не доехать.
      // Цифра выглядела как гора работы, хотя работой не была. Реальная задача
      // кладовщика — вещи, которые он сам отсканировал и привёз с ПВЗ: они в
      // виджете ниже.
      list.push({
        label: 'Рулоны с малым остатком',
        value: summary.lowStockRolls || 0,
        icon: 'AlertTriangle',
        tone: 'urgent',
        // ?low=1 — страница откроется сразу с включённым фильтром и покажет ровно
        // те рулоны, которые посчитаны в этом виджете. Раньше вела на общий список
        // из тысяч рулонов, и заканчивающиеся приходилось искать глазами.
        path: '/crm/inventory/rolls?low=1',
        stage: 'warehouse',
        hint: 'Меньше 20 погонных метров — пора заказывать',
      });
    }

    // Задвоенные заказы: одна вещь попала в систему дважды. Показываем плитку ТОЛЬКО
    // когда такие есть — в обычной ситуации она не занимает место на дашборде.
    // Молчать нельзя: на лишнюю вещь спишется материал и начислится зарплата.
    const duplicates = summary.duplicateOrders;
    if (duplicates > 0) {
      list.unshift({
        label: 'Задвоенные заказы — проверить',
        value: duplicates,
        icon: 'CopyX',
        tone: 'urgent',
        path: '/crm/marketplace/orders',
        stage: 'attention',
        hint: 'Одна вещь попала в систему дважды — проверить',
      });
    }

    if (isCutter) {
      // Закройщику показываем только то, что относится к его работе: что предстоит
      // раскроить, что уже в закрое и раскроено, срочные заказы и поставки материала
      // в цех. Остальные виджеты (пошив, стикеровка) — не его зона ответственности.
      // Сравниваем по СУТИ, а не по точному названию: у закройщика плитка
      // подписана «У меня в закрое», и список точных названий её отсеивал —
      // человек не видел собственных заказов, взятых в работу.
      const cutterWidgets = [
        'Новые задания',
        'в закрое',
        'Срочные заказы',
        'Не отгруженные поставки в цех',
        'Не принятые поставки в цехе',
        'Раскроено',
      ];
      return list.filter((w) => cutterWidgets.some((part) => w.label.includes(part)));
    }

    return list;
  }, [isCleaner, isCutter, isSewer, canSeeWarehouseWidgets, summary]);

  const content = (
    <div className="space-y-8">
      <div>
        {/* Кладовщику это не «Главная» вообще, а ЕГО рабочее место: он
            открывает смену и весь день работает на складе. Обращение по имени
            и своя смена сразу под заголовком превращают общий дашборд в
            личное пространство. */}
        <h1 className="text-xl font-bold">
          {isStorekeeper ? `Склад · ${user?.name || ''}`.trim() : 'Главная'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isStorekeeper
            ? 'Ваша смена, приёмка и отгрузки на сегодня'
            : 'Обзор производства и складских процессов на сегодня'}
        </p>
      </div>

      {/* Своя смена — первое, что видит кладовщик: идёт ли она и сколько
          принесёт при закрытии. */}
      {isStorekeeper && (
        <MyShiftCard me={myShiftStatus} loading={shiftsLoading} />
      )}

      {/* Решения склада, которые стоят денег, — сразу перед виджетами: админ видит их
          первыми, ещё до сводки по цеху. */}
      {user?.role === 'admin' && <AdminNotifications />}
      {/* Покупки за варики: сотрудник заплатил и ждёт купон — заявка не должна
          потеряться, поэтому висит на панели, пока админ не прикрепит PDF. */}
      {user?.role === 'admin' && <VarikiPurchasesCard />}

      {/* Бонусная программа: швея видит СВОЙ прогресс к премии, руководство — всех.
          Остальным ролям карточка не нужна: программа только для швей. */}
      {(isSewer || isAdmin) && (
        <>
          {/* Акция дня — выше месячной премии: её цель нужно взять до конца смены,
              поэтому она важнее для решений «здесь и сейчас». */}
          <SewerDailyCard onlyUserId={isSewer ? user?.id : undefined} />
          <SewerBonusCard onlyUserId={isSewer ? user?.id : undefined} />
        </>
      )}

      {widgets.length > 0 && <DashboardWidgetsGrid widgets={widgets} loading={dataLoading} />}

      {canSeeWorkingToday && <WorkingTodayCard />}

      {/* Эффективность цеха: кто сколько сделал, с каким темпом и с каким браком.
          Только администратору — это оценка людей, а не рабочий инструмент смены. */}
      {isAdmin && <StaffEfficiencyCard />}

      {/* Недостача в закрытых рулонах: администратор решает, удерживать ли деньги
          с сотрудников или списать на поставщика. Карточка сама скрывается, когда
          нерассмотренных рулонов нет. */}
      {isAdmin && <ShortagePenaltyCard />}

      {/* Отгрузки FBO: путь поставки от сборки до сдачи на воротах маркетплейса.
          Нужен тем, кто отвечает за отгрузку — складу, менеджеру и администратору. */}
      {canSeeFboBoard && <FboShipmentsCard />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {isAdmin ? (
          <>
            <ShiftManagementCard
              employees={employeeShifts}
              shifts={allShifts}
              loading={shiftsLoading}
              togglingId={togglingId}
              onToggle={handleToggleShift}
              onSwitchShift={handleSwitchShift}
              onToggleFree={handleToggleFree}
            />
            <ShiftCalendarCard
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              days={calendarDays}
            />
            <LototronCard actorId={user?.id} />
          </>
        ) : canSeeShiftCalendar ? (
          // Кладовщик и менеджер: график смен по календарю. Открытие и закрытие смены
          // выполняется только на терминале в цехе (киоск).
          <div className="lg:col-span-5">
            <ShiftCalendarCard
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              days={calendarDays}
            />
          </div>
        ) : null}
      </div>
    </div>
  );

  if (user && user.availableRoles.length === 0) {
    return (
      <CrmLayout>
        <div className="space-y-1">
          <h1 className="text-xl font-bold">Главная</h1>
          <p className="text-sm text-muted-foreground">
            Добро пожаловать, {user.name}. Ваша должность ещё не утверждена администратором —
            как только это произойдёт, вам откроется доступ к разделам системы.
          </p>
        </div>
      </CrmLayout>
    );
  }

  return <CrmLayout>{content}</CrmLayout>;
};

export default CrmDashboard;