import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchOrders,
  fetchOrderDetail,
  updateOrder,
  cutOrder,
  type Order,
  type OrderDetail,
  type SewingStatus,
} from '@/lib/ordersApi';
import { fetchEmployees, type Employee } from '@/lib/usersApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { fetchWorkshops, type Workshop } from '@/lib/workshopsApi';

const widthOptions = ['200', '300', '400', '500', '600', '700', '800'];
const heightOptions = [
  '220', '225', '230', '235', '240', '245', '250', '255', '260', '265', '270', '275', '280', '285', '290', '295',
];
const statusOptions: SewingStatus[] = ['Новый', 'На раскрое', 'Раскроено', 'В работе', 'Стикеровка', 'Готовые'];

const marketplaceLogo: Record<string, { label: string; className: string }> = {
  OZON: { label: 'OZON', className: 'text-[#005BFF] font-bold' },
  WB: { label: 'Wildberries', className: 'text-[#CB11AB] font-bold' },
  Yandex: { label: 'Яндекс.Маркет', className: 'text-[#FFCC00] font-bold' },
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const timeAgo = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days > 0) return `${days} дн. ${remHours} час. назад`;
  return `${hours} час. назад`;
};

const SewingItems = () => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [typeFilter, setTypeFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [materialFilter, setMaterialFilter] = useState('all');
  const [widthFilter, setWidthFilter] = useState('all');
  const [heightFilter, setHeightFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [workshopFilter, setWorkshopFilter] = useState('all');

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cutting, setCutting] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([fetchOrders(), fetchEmployees(), fetchMaterialsData(), fetchWorkshops()])
      .then(([ordersData, employeesData, materialsData, workshopsData]) => {
        setOrders(ordersData);
        setEmployees(employeesData);
        setMaterials(materialsData.materials);
        setWorkshops(workshopsData);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const filteredOrders = orders.filter((o) => {
    if (typeFilter !== 'all' && o.orderType !== typeFilter) return false;
    if (employeeFilter !== 'all' && String(o.assignedUserId) !== employeeFilter) return false;
    if (materialFilter !== 'all' && o.material !== materials.find((m) => String(m.id) === materialFilter)?.name) return false;
    if (widthFilter !== 'all' && String(o.width) !== widthFilter) return false;
    if (heightFilter !== 'all' && String(o.height) !== heightFilter) return false;
    if (statusFilter !== 'all' && o.sewingStatus !== statusFilter) return false;
    if (workshopFilter !== 'all' && String(o.workshopId) !== workshopFilter) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / 10));
  const pagedOrders = filteredOrders.slice((page - 1) * 10, page * 10);

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

  const handleCut = async () => {
    if (!selectedOrder) return;
    setCutting(true);
    try {
      await cutOrder(selectedOrder.id);
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

  return (
    <CrmLayout>
      <div className="space-y-6">
        <h1 className="text-xl font-bold">Товары для пошива</h1>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Все типы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все типы</SelectItem>
              <SelectItem value="FBO">FBO</SelectItem>
              <SelectItem value="FBS">FBS</SelectItem>
            </SelectContent>
          </Select>

          <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Все сотрудники" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все сотрудники</SelectItem>
              {employees.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  {e.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={materialFilter} onValueChange={setMaterialFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Все материалы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все материалы</SelectItem>
              {materials.map((m) => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={widthFilter} onValueChange={setWidthFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Все ширины" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все ширины</SelectItem>
              {widthOptions.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={heightFilter} onValueChange={setHeightFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Все высоты" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все высоты</SelectItem>
              {heightOptions.map((h) => (
                <SelectItem key={h} value={h}>
                  {h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Все статусы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={workshopFilter} onValueChange={setWorkshopFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Все цеха" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все цеха</SelectItem>
              {workshops.map((w) => (
                <SelectItem key={w.id} value={String(w.id)}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            <div className="rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground">#</TableHead>
                    <TableHead className="text-primary-foreground">Статус</TableHead>
                    <TableHead className="text-primary-foreground">Номер заказа</TableHead>
                    <TableHead className="text-primary-foreground">Кластер</TableHead>
                    <TableHead className="text-primary-foreground">Название</TableHead>
                    <TableHead className="text-primary-foreground">Ширина</TableHead>
                    <TableHead className="text-primary-foreground">Высота</TableHead>
                    <TableHead className="text-primary-foreground">Маркетплейс</TableHead>
                    <TableHead className="text-primary-foreground">Тип</TableHead>
                    <TableHead className="text-primary-foreground">Сотрудники</TableHead>
                    <TableHead className="text-primary-foreground">Создан</TableHead>
                    <TableHead className="text-primary-foreground">Выполнен</TableHead>
                    <TableHead className="text-primary-foreground" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedOrders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>{o.id}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{o.sewingStatus}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{o.orderNumber}</TableCell>
                      <TableCell>{o.cluster || '—'}</TableCell>
                      <TableCell>{o.material || '—'}</TableCell>
                      <TableCell>{o.width ?? '—'}</TableCell>
                      <TableCell>{o.height ?? '—'}</TableCell>
                      <TableCell>
                        <span className={marketplaceLogo[o.marketplace]?.className}>
                          {marketplaceLogo[o.marketplace]?.label || o.marketplace}
                        </span>
                      </TableCell>
                      <TableCell>{o.orderType}</TableCell>
                      <TableCell>{o.assignedUserName || '—'}</TableCell>
                      <TableCell>
                        <div className="whitespace-nowrap">{formatDate(o.createdAt)}</div>
                        <Badge variant="destructive" className="mt-1 font-normal">
                          {timeAgo(o.createdAt)}
                        </Badge>
                      </TableCell>
                      <TableCell>{o.completedAt ? formatDate(o.completedAt) : ''}</TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          className="bg-blue-600 text-white hover:bg-blue-700"
                          onClick={() => openDetail(o)}
                        >
                          <Icon name="Eye" size={14} className="mr-1.5" />
                          Просмотр
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationLink
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="cursor-pointer"
                    >
                      <Icon name="ChevronLeft" size={16} />
                    </PaginationLink>
                  </PaginationItem>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                    <PaginationItem key={p}>
                      <PaginationLink
                        isActive={p === page}
                        onClick={() => setPage(p)}
                        className="cursor-pointer"
                      >
                        {p}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationLink
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="cursor-pointer"
                    >
                      <Icon name="ChevronRight" size={16} />
                    </PaginationLink>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle>Товар #{selectedOrder?.id}</DialogTitle>
                {selectedOrder && <Badge variant="secondary">{selectedOrder.sewingStatus}</Badge>}
              </div>
            </DialogHeader>
            {selectedOrder && (
              <div className="space-y-4">
                <Card className="border-border shadow-none">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Действия</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-end gap-3">
                    <div className="w-48 space-y-1.5">
                      <Label>Статус пошива</Label>
                      <Select value={selectedOrder.sewingStatus} onValueChange={handleStatusChange} disabled={saving}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {statusOptions.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="w-48 space-y-1.5">
                      <Label>Сотрудник</Label>
                      <Select
                        value={selectedOrder.assignedUserId ? String(selectedOrder.assignedUserId) : 'none'}
                        onValueChange={handleAssignUser}
                        disabled={saving}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Не назначен" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Не назначен</SelectItem>
                          {employees.map((e) => (
                            <SelectItem key={e.id} value={String(e.id)}>
                              {e.fullName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="w-48 space-y-1.5">
                      <Label>Цех</Label>
                      <Select
                        value={selectedOrder.workshopId ? String(selectedOrder.workshopId) : 'none'}
                        onValueChange={handleAssignWorkshop}
                        disabled={saving}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Не назначен" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Не назначен</SelectItem>
                          {workshops.map((w) => (
                            <SelectItem key={w.id} value={String(w.id)}>
                              {w.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      onClick={handleCut}
                      disabled={cutting || selectedOrder.sewingStatus === 'Раскроено'}
                    >
                      {cutting ? (
                        <>
                          <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
                          Списываем материалы...
                        </>
                      ) : (
                        <>
                          <Icon name="Scissors" size={16} className="mr-2" />
                          Раскроить
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <Card className="border-border shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Информация</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableBody>
                          <TableRow>
                            <TableCell className="font-medium text-muted-foreground">Товар</TableCell>
                            <TableCell>
                              {selectedOrder.material} {selectedOrder.width}×{selectedOrder.height}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium text-muted-foreground">Номер заказа</TableCell>
                            <TableCell>{selectedOrder.orderNumber}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium text-muted-foreground">Маркетплейс</TableCell>
                            <TableCell>
                              <span className={marketplaceLogo[selectedOrder.marketplace]?.className}>
                                {marketplaceLogo[selectedOrder.marketplace]?.label || selectedOrder.marketplace}
                              </span>
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium text-muted-foreground">Тип</TableCell>
                            <TableCell>{selectedOrder.orderType}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium text-muted-foreground">Кластер</TableCell>
                            <TableCell>{selectedOrder.cluster || '—'}</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>

                  <Card className="border-border shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Материалы</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {detailLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Icon name="Loader2" size={14} className="animate-spin" />
                          Загрузка...
                        </div>
                      ) : orderDetail && orderDetail.materialUsage.length > 0 ? (
                        orderDetail.materialUsage.map((mu) => (
                          <div key={mu.id} className="rounded border border-border p-2">
                            <div className="mb-1 flex items-center justify-between">
                              <span className="font-semibold">{mu.materialName}</span>
                              <span className="text-sm text-muted-foreground">
                                {mu.quantity} {mu.unit}
                              </span>
                            </div>
                            {mu.rollBarcode && (
                              <div className="text-xs text-muted-foreground">
                                Рулон #{mu.rollBarcode}
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Материалы ещё не списаны — выполните раскрой
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="border-border shadow-none">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm">Сотрудники</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableBody>
                          {selectedOrder.assignedUserName ? (
                            <TableRow>
                              <TableCell className="font-medium text-muted-foreground">Назначен</TableCell>
                              <TableCell>{selectedOrder.assignedUserName}</TableCell>
                            </TableRow>
                          ) : (
                            <TableRow>
                              <TableCell colSpan={2} className="text-center text-muted-foreground">
                                Сотрудники не назначены
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </div>

                <Card className="border-border shadow-none">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">Таймлайн</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">{formatDate(selectedOrder.createdAt)}</Badge>
                      <span className="flex items-center gap-1.5 text-sm">
                        <Icon name="Plus" size={14} className="text-blue-600" />
                        Заказ создан
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary">{timeAgo(selectedOrder.createdAt)}</Badge>
                      <span className="flex items-center gap-1.5 text-sm">
                        <Icon name="MapPin" size={14} className="text-muted-foreground" />
                        <Badge variant="secondary">{selectedOrder.sewingStatus}</Badge>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </CrmLayout>
  );
};

export default SewingItems;