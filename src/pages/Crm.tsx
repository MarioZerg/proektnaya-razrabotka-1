import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import CrmLayout from '@/components/crm/CrmLayout';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { fetchOrders, type Order } from '@/lib/ordersApi';
import { fetchRolls, type Roll } from '@/lib/rollsApi';
import { fetchGoodsWarehouse, type GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { fetchMarketplaceReturns } from '@/lib/marketplaceReturnsApi';
import { fetchShipments, type Shipment } from '@/lib/shipmentsApi';
import { updateEmployee } from '@/lib/usersApi';
import {
  fetchEmployeeShifts,
  fetchShiftCalendar,
  openShift,
  closeShift,
  type EmployeeShiftStatus,
  type ShiftCalendarDay,
} from '@/lib/shiftSessionsApi';
import { fetchShifts, type ShiftListItem } from '@/lib/shiftsApi';
import DashboardWidgetsGrid from '@/components/crm/dashboard/DashboardWidgetsGrid';
import WorkingTodayCard from '@/components/crm/dashboard/WorkingTodayCard';
import ShiftManagementCard from '@/components/crm/dashboard/ShiftManagementCard';
import ShiftCalendarCard from '@/components/crm/dashboard/ShiftCalendarCard';
import LototronCard from '@/components/crm/dashboard/LototronCard';
import ShortagePenaltyCard from '@/components/crm/dashboard/ShortagePenaltyCard';
import FboShipmentsCard from '@/components/crm/dashboard/FboShipmentsCard';
import { ROLL_LOW_STOCK_THRESHOLD, type DashboardWidgetData } from '@/components/crm/dashboard/dashboardShared';
import { isMetersUnit } from '@/lib/stockLevels';
import { isStorekeeperRole } from '@/lib/roles';
import { countDuplicateOrders } from '@/lib/findDuplicateOrders';

const CrmDashboard = () => {
  const { user, setActiveShift } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin';
  const isCleaner = user?.role === 'cleaner';
  const isCutter = user?.role === 'cutter';
  const canSeeWarehouseWidgets = user?.role === 'admin' || isStorekeeperRole(user?.role);
  // Кладовщик и менеджер видят календарь-график смен (какие смены сегодня работают),
  // но без управления сменами сотрудников — это только для админа.
  const canSeeShiftCalendar = isAdmin || isStorekeeperRole(user?.role) || user?.role === 'manager';
  // Отгрузки FBO ведут склад и менеджер маркетплейса, администратор смотрит за всеми.
  const canSeeFboBoard = isAdmin || isStorekeeperRole(user?.role) || user?.role === 'manager';
  // Кто сегодня работает — управленческая информация. Производственным ролям (швея,
  // закройщик, упаковщица, уборщица) она не нужна и только загромождает их кабинет.
  const canSeeWorkingToday = canSeeShiftCalendar;

  const [dataLoading, setDataLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [goodsItems, setGoodsItems] = useState<GoodsWarehouseItem[]>([]);
  const [shipmentsToWorkshop, setShipmentsToWorkshop] = useState<Shipment[]>([]);
  const [returnsWaiting, setReturnsWaiting] = useState(0);
  // Возвраты, забранные с пункта выдачи, но ещё не осмотренные кладовщиком.
  const [returnsPickedUp, setReturnsPickedUp] = useState(0);

  const [shiftsLoading, setShiftsLoading] = useState(true);
  const [employeeShifts, setEmployeeShifts] = useState<EmployeeShiftStatus[]>([]);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [allShifts, setAllShifts] = useState<ShiftListItem[]>([]);

  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [calendarDays, setCalendarDays] = useState<ShiftCalendarDay[]>([]);

  // Данные для виджетов — загружаются только если у роли есть хоть один виджет
  useEffect(() => {
    if (isCleaner) {
      setDataLoading(false);
      return;
    }
    setDataLoading(true);
    Promise.all([
      fetchOrders(),
      canSeeWarehouseWidgets ? fetchRolls({ status: 'in_workshop' }) : Promise.resolve([]),
      canSeeWarehouseWidgets ? fetchGoodsWarehouse() : Promise.resolve([]),
      fetchShipments('to_workshop'),
      // Возвраты с маркетплейсов, которые ждут приёмки на складе — задача кладовщика.
      canSeeWarehouseWidgets
        ? fetchMarketplaceReturns({ status: 'new' })
        : Promise.resolve({ returns: [], counts: {} as Record<string, number> }),
    ])
      .then(([ordersData, rollsData, goodsData, shipmentsData, returnsData]) => {
        setOrders(ordersData);
        setRolls(rollsData);
        setGoodsItems(goodsData);
        setShipmentsToWorkshop(shipmentsData);
        setReturnsWaiting(returnsData.counts.new || 0);
        setReturnsPickedUp(returnsData.counts.picked_up || 0);
      })
      .finally(() => setDataLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  // Смены: у админа — список всех сотрудников, у остальных — только свой статус
  const loadShifts = () => {
    setShiftsLoading(true);
    fetchEmployeeShifts()
      .then(setEmployeeShifts)
      .finally(() => setShiftsLoading(false));
  };

  useEffect(() => {
    if (isCleaner) {
      setShiftsLoading(false);
      return;
    }
    loadShifts();
    if (isAdmin) fetchShifts().then(setAllShifts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  useEffect(() => {
    if (!canSeeShiftCalendar || !selectedDate) return;
    const month = format(selectedDate, 'yyyy-MM');
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
        await closeShift(employee.id, true);
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
      await updateEmployee(employeeId, { workshop: shift.workshopName, shiftNumber: shift.shiftNumber });
      toast({ title: 'Смена сотрудника переключена' });
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

    const newOrders = orders.filter((o) => o.sewingStatus === 'Новый').length;
    const inSewing = orders.filter((o) => o.sewingStatus === 'В работе').length;
    const inCutting = orders.filter((o) => o.sewingStatus === 'На раскрое').length;
    const urgentFbs = orders.filter((o) => o.orderType === 'FBS' && o.status !== 'Выполнен' && o.status !== 'Отменён').length;
    const inStickering = orders.filter((o) => o.sewingStatus === 'Стикеровка').length;
    const cut = orders.filter((o) => o.sewingStatus === 'Раскроено').length;
    const notShippedToWorkshop = shipmentsToWorkshop.filter((s) => s.status === 'Новый').length;
    const notReceivedInWorkshop = shipmentsToWorkshop.filter((s) => s.status === 'Отправлено').length;

    const list: DashboardWidgetData[] = [
      { label: 'Новые задания на пошив', value: newOrders, icon: 'ListPlus', tone: 'default', path: '/crm/marketplace/sewing-items' },
      { label: 'Товары в пошиве', value: inSewing, icon: 'Shirt', tone: 'default', path: '/crm/marketplace/sewing-items' },
      { label: 'Товары в закрое', value: inCutting, icon: 'Scissors', tone: 'default', path: '/crm/marketplace/sewing-items' },
      // ?type=FBS — страница откроется сразу с фильтром по FBS, иначе показывала все заказы
      { label: 'Срочные заказы (FBS)', value: urgentFbs, icon: 'Zap', tone: 'urgent', path: '/crm/marketplace/sewing-items?type=FBS' },
      { label: 'Не отгруженные поставки в цех', value: notShippedToWorkshop, icon: 'TruckElectric', tone: 'warning', path: '/crm/shipments/to-workshop' },
      { label: 'Не принятые поставки в цехе', value: notReceivedInWorkshop, icon: 'PackageX', tone: 'warning', path: '/crm/shipments/to-workshop' },
      { label: 'Товары на стикеровке', value: inStickering, icon: 'Tag', tone: 'default', path: '/crm/marketplace/sewing-items' },
      { label: 'Раскроено', value: cut, icon: 'CheckCircle2', tone: 'default', path: '/crm/marketplace/sewing-items' },
    ];

    if (canSeeWarehouseWidgets) {
      // Малый остаток считаем только по рулонам в погонных метрах и только среди активных
      // (не завершённых) — меньше 20 пог.м.
      const lowStockRolls = rolls.filter(
        (r) =>
          r.status !== 'completed' &&
          isMetersUnit(r.unit) &&
          r.remainingQuantity < ROLL_LOW_STOCK_THRESHOLD
      ).length;
      // Вещи, отменённые клиентом: упаковщик наклеил стикер хранения, но кладовщик ещё не
      // забрал их из цеха и не положил на полку — это его прямая задача на сегодня.
      const awaitingShelf = goodsItems.filter((g) => g.status === 'awaiting_shelf').length;
      // Заказы, которые закрываются вещью с полки и ждут стикера отправления от кладовщика.
      const awaitingShipLabel = goodsItems.filter(
        (g) => g.reservedOrderId && !g.shippingLabeledAt && g.status === 'in_stock',
      ).length;
      const inStock = goodsItems.filter((g) => g.status === 'in_stock').length;

      list.splice(4, 0, {
        label: 'Товары к подбору со склада',
        value: inStock,
        icon: 'PackageSearch',
        tone: 'default',
        path: '/crm/inventory/goods-warehouse',
      });
      list.splice(4, 0, {
        label: 'Отменено — забрать из цеха на полку',
        value: awaitingShelf,
        icon: 'PackageCheck',
        tone: awaitingShelf > 0 ? 'urgent' : 'default',
        path: '/crm/inventory/goods-warehouse',
      });
      list.splice(5, 0, {
        label: 'Заказы с полок — наклеить стикер',
        value: awaitingShipLabel,
        icon: 'Tags',
        tone: awaitingShipLabel > 0 ? 'warning' : 'default',
        path: '/crm/inventory/goods-warehouse',
      });
      // Вещи привезли с ПВЗ, но кладовщик их ещё не осмотрел. Пока они не лежат
      // на полке, товар считается непроверенным и в подбор не идёт.
      list.push({
        label: 'Возвраты — непроверенные, разобрать',
        value: returnsPickedUp,
        icon: 'PackageOpen',
        tone: returnsPickedUp > 0 ? 'urgent' : 'default',
        path: '/crm/shipments/receive-returns',
      });
      list.push({
        label: 'Возвраты — принять на склад',
        value: returnsWaiting,
        icon: 'Undo2',
        tone: returnsWaiting > 0 ? 'warning' : 'default',
        path: '/crm/shipments/receive-returns',
      });
      list.push({
        label: 'Рулоны с малым остатком',
        value: lowStockRolls,
        icon: 'AlertTriangle',
        tone: 'urgent',
        path: '/crm/inventory/rolls',
      });
    }

    // Задвоенные заказы: одна вещь попала в систему дважды. Показываем плитку ТОЛЬКО
    // когда такие есть — в обычной ситуации она не занимает место на дашборде.
    // Молчать нельзя: на лишнюю вещь спишется материал и начислится зарплата.
    const duplicates = countDuplicateOrders(orders);
    if (duplicates > 0) {
      list.unshift({
        label: 'Задвоенные заказы — проверить',
        value: duplicates,
        icon: 'CopyX',
        tone: 'urgent',
        path: '/crm/marketplace/orders',
      });
    }

    if (isCutter) {
      // Закройщику показываем только то, что относится к его работе: что предстоит
      // раскроить, что уже в закрое и раскроено, срочные заказы и поставки материала
      // в цех. Остальные виджеты (пошив, стикеровка) — не его зона ответственности.
      const cutterWidgets = [
        'Новые задания на пошив',
        'Товары в закрое',
        'Срочные заказы (FBS)',
        'Не отгруженные поставки в цех',
        'Не принятые поставки в цехе',
        'Раскроено',
      ];
      return list.filter((w) => cutterWidgets.includes(w.label));
    }

    return list;
  }, [isCleaner, isCutter, canSeeWarehouseWidgets, orders, rolls, goodsItems, shipmentsToWorkshop, returnsWaiting, returnsPickedUp]);

  const content = (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Главная</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Обзор производства и складских процессов на сегодня
        </p>
      </div>

      {widgets.length > 0 && <DashboardWidgetsGrid widgets={widgets} loading={dataLoading} />}

      {canSeeWorkingToday && <WorkingTodayCard />}

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