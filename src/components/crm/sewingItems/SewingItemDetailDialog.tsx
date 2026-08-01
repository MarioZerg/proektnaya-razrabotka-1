import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { Order, OrderDetail } from '@/lib/ordersApi';
import type { Employee } from '@/lib/usersApi';
import type { Workshop } from '@/lib/workshopsApi';
import { marketplaceLogo, formatDate, timeAgo, statusOptions } from '@/components/crm/sewingItems/sewingItemsShared';

interface SewingItemDetailDialogProps {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  selectedOrder: Order | null;
  orderDetail: OrderDetail | null;
  detailLoading: boolean;
  saving: boolean;
  cutting: boolean;
  employees: Employee[];
  workshops: Workshop[];
  onStatusChange: (status: string) => void;
  onAssignUser: (userId: string) => void;
  onAssignWorkshop: (workshopId: string) => void;
  onCut: () => void;
  readOnly?: boolean;
}

const SewingItemDetailDialog = ({
  dialogOpen,
  setDialogOpen,
  selectedOrder,
  orderDetail,
  detailLoading,
  saving,
  cutting,
  employees,
  workshops,
  onStatusChange,
  onAssignUser,
  onAssignWorkshop,
  onCut,
  readOnly = false,
}: SewingItemDetailDialogProps) => {
  return (
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
            {!readOnly && (
              <Card className="border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Действия</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-end gap-3">
                  <div className="w-48 space-y-1.5">
                    <Label>Статус пошива</Label>
                    <Select value={selectedOrder.sewingStatus} onValueChange={onStatusChange} disabled={saving}>
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
                      onValueChange={onAssignUser}
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
                      onValueChange={onAssignWorkshop}
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
                    onClick={onCut}
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
            )}

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
  );
};

export default SewingItemDetailDialog;