import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import CrmLayout from '@/components/crm/CrmLayout';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { fetchOrders, type Order } from '@/lib/ordersApi';
import { fetchRolls, type Roll } from '@/lib/rollsApi';
import { fetchGoodsWarehouse, type GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { fetchShipments, type Shipment } from '@/lib/shipmentsApi';
import { fetchEmployees, type Employee } from '@/lib/usersApi';
import {
  fetchEmployeeShifts,
  fetchShiftCalendar,
  openShift,
  closeShift,
  type EmployeeShiftStatus,
  type ShiftCalendarDay,
} from '@/lib/shiftSessionsApi';
import DashboardWidgetsGrid from '@/components/crm/dashboard/DashboardWidgetsGrid';
import ShiftManagementCard from '@/components/crm/dashboard/ShiftManagementCard';
import ShiftCalendarCard from '@/components/crm/dashboard/ShiftCalendarCard';
import MyShiftCard from '@/components/crm/dashboard/MyShiftCard';
import MySalaryCard from '@/components/crm/dashboard/MySalaryCard';
import { ROLL_LOW_STOCK_THRESHOLD, type DashboardWidgetData } from '@/components/crm/dashboard/dashboardShared';

const CrmDashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === 'admin';
  const isCleaner = user?.role === 'cleaner';
  const canSeeWarehouseWidgets = user?.role === 'admin' || user?.role === 'storekeeper';

  const [dataLoading, setDataLoading] = useState(true);
  const [orders, setOrders] = useState<Order[]>([]);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [goodsItems, setGoodsItems] = useState<GoodsWarehouseItem[]>([]);
  const [shipmentsToWorkshop, setShipmentsToWorkshop] = useState<Shipment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [shiftsLoading, setShiftsLoading] = useState(true);
  const [employeeShifts, setEmployeeShifts] = useState<EmployeeShiftStatus[]>([]);
  const [togglingId, setTogglingId] = useState<number | null>(null);

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
      canSeeWarehouseWidgets ? fetchGoodsWarehouse('in_stock') : Promise.resolve([]),
      fetchShipments('to_workshop'),
      user?.role !== 'admin' ? fetchEmployees() : Promise.resolve([]),
    ])
      .then(([ordersData, rollsData, goodsData, shipmentsData, employeesData]) => {
        setOrders(ordersData);
        setRolls(rollsData);
        setGoodsItems(goodsData);
        setShipmentsToWorkshop(shipmentsData);
        setEmployees(employeesData);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role]);

  useEffect(() => {
    if (!isAdmin || !selectedDate) return;
    const month = format(selectedDate, 'yyyy-MM');
    fetchShiftCalendar(month).then(setCalendarDays);
  }, [isAdmin, selectedDate]);

  const myShiftStatus = useMemo(
    () => employeeShifts.find((e) => e.id === user?.id) || null,
    [employeeShifts, user?.id]
  );

  const mySalary = useMemo(
    () => employees.find((e) => e.id === user?.id)?.salary ?? null,
    [employees, user?.id]
  );

  const handleToggleShift = async (employee: EmployeeShiftStatus) => {
    setTogglingId(employee.id);
    try {
      if (employee.isOpen) {
        await closeShift(employee.id);
      } else {
        await openShift(employee.id);
      }
      loadShifts();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setTogglingId(null);
    }
  };

  const handleToggleMyShift = async () => {
    if (!user) return;
    setTogglingId(user.id);
    try {
      if (myShiftStatus?.isOpen) {
        await closeShift(user.id);
      } else {
        await openShift(user.id, user.workshopId, user.shiftNumber);
      }
      loadShifts();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setTogglingId(null);
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
      const lowStockRolls = rolls.filter((r) => r.remainingQuantity < ROLL_LOW_STOCK_THRESHOLD).length;
      list.splice(4, 0, {
        label: 'Товары к подбору со склада',
        value: goodsItems.length,
        icon: 'PackageSearch',
        tone: 'default',
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {isAdmin ? (
          <>
            <ShiftManagementCard
              employees={employeeShifts}
              loading={shiftsLoading}
              togglingId={togglingId}
              onToggle={handleToggleShift}
            />
            <ShiftCalendarCard
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              days={calendarDays}
            />
          </>
        ) : (
          !isCleaner && (
            <>
              <div className="lg:col-span-2">
                <MyShiftCard
                  status={myShiftStatus}
                  loading={shiftsLoading}
                  toggling={togglingId === user?.id}
                  onToggle={handleToggleMyShift}
                />
              </div>
              <div className="lg:col-span-2">
                <MySalaryCard salary={mySalary} loading={dataLoading} />
              </div>
            </>
          )
        )}
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
