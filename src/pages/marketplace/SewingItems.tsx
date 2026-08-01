import { useEffect, useMemo, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchOrders,
  fetchOrderDetail,
  updateOrder,
  cutOrder,
  takeStack,
  type Order,
  type OrderDetail,
  type SewingStatus,
} from '@/lib/ordersApi';
import { fetchEmployees, type Employee } from '@/lib/usersApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';
import { fetchRolls, type Roll } from '@/lib/rollsApi';
import SewingItemsFilters from '@/components/crm/sewingItems/SewingItemsFilters';
import SewingItemsTable from '@/components/crm/sewingItems/SewingItemsTable';
import SewingItemDetailDialog from '@/components/crm/sewingItems/SewingItemDetailDialog';
import { statusTabs } from '@/components/crm/sewingItems/sewingItemsShared';

const SewingItems = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [takingStack, setTakingStack] = useState(false);

  const isCutter = user?.role === 'cutter';
  const isProductionRole = user?.role === 'sewer' || user?.role === 'cutter' || user?.role === 'packer';

  const visibleTabs = useMemo(
    () => (isProductionRole ? statusTabs.filter((t) => t.value !== 'Новый') : statusTabs),
    [isProductionRole]
  );

  const [activeTab, setActiveTab] = useState<SewingStatus>(visibleTabs[0]?.value || 'Новый');

  const [typeFilter, setTypeFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [materialFilter, setMaterialFilter] = useState('all');
  const [widthFilter, setWidthFilter] = useState('all');
  const [heightFilter, setHeightFilter] = useState('all');
  const [workshopFilter, setWorkshopFilter] = useState('all');

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cutting, setCutting] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([fetchOrders(), fetchEmployees(), fetchMaterialsData(), fetchWorkshops(), fetchRolls({ status: 'in_workshop' })])
      .then(([ordersData, employeesData, materialsData, workshopsData, rollsData]) => {
        setOrders(ordersData);
        setEmployees(employeesData);
        setMaterials(materialsData.materials);
        setWorkshops(workshopsData);
        setRolls(rollsData);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const isReadOnlyTab = activeTab === 'Раскроено' && (user?.role === 'sewer' || user?.role === 'cutter');

  const ordersInTab = orders.filter((o) => o.sewingStatus === activeTab);

  const filteredOrders = ordersInTab.filter((o) => {
    if (typeFilter !== 'all' && o.orderType !== typeFilter) return false;
    if (employeeFilter !== 'all' && String(o.assignedUserId) !== employeeFilter) return false;
    if (materialFilter !== 'all' && o.material !== materials.find((m) => String(m.id) === materialFilter)?.name) return false;
    if (widthFilter !== 'all' && String(o.width) !== widthFilter) return false;
    if (heightFilter !== 'all' && String(o.height) !== heightFilter) return false;
    if (workshopFilter !== 'all' && String(o.workshopId) !== workshopFilter) return false;
    if (
      (activeTab === 'В работе' || activeTab === 'На раскрое') &&
      isProductionRole &&
      o.assignedUserId !== user?.id
    ) {
      return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / 10));
  const pagedOrders = filteredOrders.slice((page - 1) * 10, page * 10);

  const countForTab = (status: SewingStatus) => {
    if ((status === 'В работе' || status === 'На раскрое') && isProductionRole) {
      return orders.filter((o) => o.sewingStatus === status && o.assignedUserId === user?.id).length;
    }
    return orders.filter((o) => o.sewingStatus === status).length;
  };

  const myUnfinishedCount = orders.filter(
    (o) => o.sewingStatus === 'На раскрое' && o.assignedUserId === user?.id
  ).length;

  const loadDetail = async (orderId: number) => {
    setDetailLoading(true);
    try {
      const detail = await fetchOrderDetail(orderId);
      setOrderDetail(detail);
    } finally {
      setDetailLoading(false);
    }
  };

  const openDetail = (order: Order) => {
    setSelectedOrder(order);
    setOrderDetail(null);
    setDialogOpen(true);
    loadDetail(order.id);
  };

  const handleAssignUser = async (userId: string) => {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      await updateOrder(selectedOrder.id, { assignedUserId: userId === 'none' ? null : Number(userId) });
      toast({ title: 'Сотрудник назначен' });
      const updated = { ...selectedOrder, assignedUserId: userId === 'none' ? null : Number(userId) };
      setSelectedOrder(updated);
      load();
      loadDetail(selectedOrder.id);
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleAssignWorkshop = async (workshopId: string) => {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      await updateOrder(selectedOrder.id, { workshopId: workshopId === 'none' ? null : Number(workshopId) });
      toast({ title: 'Цех назначен' });
      const updated = { ...selectedOrder, workshopId: workshopId === 'none' ? null : Number(workshopId) };
      setSelectedOrder(updated);
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (status: string) => {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      await updateOrder(selectedOrder.id, { sewingStatus: status as SewingStatus });
      toast({ title: 'Статус обновлён' });
      setSelectedOrder({ ...selectedOrder, sewingStatus: status });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleCut = async (rollId?: number) => {
    if (!selectedOrder) return;
    setCutting(true);
    try {
      await cutOrder(selectedOrder.id, rollId);
      toast({ title: 'Раскрой выполнен', description: 'Материалы списаны с рулонов' });
      setSelectedOrder({ ...selectedOrder, sewingStatus: 'Раскроено' });
      load();
      loadDetail(selectedOrder.id);
    } catch (e) {
      toast({
        title: 'Не удалось выполнить раскрой',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setCutting(false);
    }
  };

  const handleTakeStack = async () => {
    if (!user?.workshopId) {
      toast({ title: 'У вас не указан цех в профиле', variant: 'destructive' });
      return;
    }
    setTakingStack(true);
    try {
      const res = await takeStack(user.id, user.workshopId, user.shiftNumber);
      toast({ title: `Взято в работу заказов: ${res.count}` });
      setActiveTab('На раскрое');
      load();
    } catch (e) {
      toast({ title: 'Не удалось взять стек', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setTakingStack(false);
    }
  };

  const myWorkshopRolls = rolls.filter(
    (r) => r.workshopId === user?.workshopId && (!user?.shiftNumber || r.shiftNumber === user.shiftNumber)
  );

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Товары для пошива</h1>
          {isCutter && (
            <Button onClick={handleTakeStack} disabled={takingStack || myUnfinishedCount > 0}>
              {takingStack ? (
                <>
                  <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
                  Берём заказы...
                </>
              ) : (
                <>
                  <Icon name="Layers" size={16} className="mr-2" />
                  Взять стек заказов
                </>
              )}
            </Button>
          )}
        </div>

        {isCutter && myUnfinishedCount > 0 && (
          <p className="text-sm text-muted-foreground">
            У вас {myUnfinishedCount} нераскроенных заказов — раскроите их, прежде чем брать новый стек.
          </p>
        )}

        <Tabs
          value={activeTab}
          onValueChange={(v) => {
            setActiveTab(v as SewingStatus);
            setPage(1);
          }}
        >
          <TabsList className="flex h-auto flex-wrap justify-start gap-1">
            {visibleTabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                {tab.label}
                <Badge variant="secondary" className="ml-1">
                  {countForTab(tab.value)}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <SewingItemsFilters
          employees={employees}
          materials={materials}
          workshops={workshops}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          employeeFilter={employeeFilter}
          setEmployeeFilter={setEmployeeFilter}
          materialFilter={materialFilter}
          setMaterialFilter={setMaterialFilter}
          widthFilter={widthFilter}
          setWidthFilter={setWidthFilter}
          heightFilter={heightFilter}
          setHeightFilter={setHeightFilter}
          workshopFilter={workshopFilter}
          setWorkshopFilter={setWorkshopFilter}
        />

        <SewingItemsTable
          loading={loading}
          pagedOrders={pagedOrders}
          onOpenDetail={openDetail}
          page={page}
          setPage={setPage}
          totalPages={totalPages}
        />

        <SewingItemDetailDialog
          dialogOpen={dialogOpen}
          setDialogOpen={setDialogOpen}
          selectedOrder={selectedOrder}
          orderDetail={orderDetail}
          detailLoading={detailLoading}
          saving={saving}
          cutting={cutting}
          employees={employees}
          workshops={workshops}
          onStatusChange={handleStatusChange}
          onAssignUser={handleAssignUser}
          onAssignWorkshop={handleAssignWorkshop}
          onCut={handleCut}
          readOnly={isReadOnlyTab}
          isCutterView={isCutter}
          availableRolls={myWorkshopRolls}
        />
      </div>
    </CrmLayout>
  );
};

export default SewingItems;
