import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import CrmLayout from '@/components/crm/CrmLayout';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { fetchOrders, type Order } from '@/lib/ordersApi';
import { fetchRolls, type Roll } from '@/lib/rollsApi';
import { fetchGoodsWarehouse, type GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
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
import { ROLL_LOW_STOCK_THRESHOLD, type DashboardWidgetData } from '@/components/crm/dashboard/dashboardShared';
import { isMetersUnit } from '@/lib/stockLevels';

const CrmDashboard = () => {
  const { user, setActiveShift } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin';
  const isCleaner = user?.role === 'cleaner';
  const canSeeWarehouseWidgets = user?.role === 'admin' || user?.role === 'storekeeper';
  // Кладовщик и менеджер видят календарь-график смен (какие смены сегодня работают),
  // но без управления сменами сотрудников — это только для админа.
  const canSeeShiftCalendar = isAdmin || user?.role === 'storekeeper' || user?.role === 'manager';

  const [dataLoading, setDataLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [goodsItems, setGoodsItems] = useState<GoodsWarehouseItem[]>([]);
  const [shipmentsToWorkshop, setShipmentsToWorkshop] = useState<Shipment[]>([]);

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
    ])
      .then(([ordersData, rollsData, goodsData, shipmentsData]) => {
        setOrders(ordersData);
        setRolls(rollsData);
        setGoodsItems(goodsData);
        setShipmentsToWorkshop(shipmentsData);
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
        await closeShift(employee.id);
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
      { label: 'Срочные заказы (FBS)', value: urgentFbs, icon: 'Zap', tone: 'urgent', path: '/crm/marketplace/sewing-items' },
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
      list.push({
        label: 'Рулоны с малым остатком',
        value: lowStockRolls,
        icon: 'AlertTriangle',
        tone: 'urgent',
        path: '/crm/inventory/rolls',
      });
    }

    return list;
  }, [isCleaner, canSeeWarehouseWidgets, orders, rolls, goodsItems, shipmentsToWorkshop]);

  const content = (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold">Главная</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Обзор производства и складских процессов на сегодня
        </p>
      </div>

      {widgets.length > 0 && <DashboardWidgetsGrid widgets={widgets} loading={dataLoading} />}

      <WorkingTodayCard />

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