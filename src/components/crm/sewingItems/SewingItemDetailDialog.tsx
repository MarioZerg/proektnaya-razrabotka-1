import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import type { Roll } from '@/lib/rollsApi';
import { marketplaceLogo, formatDate, timeAgo, statusOptions } from '@/components/crm/sewingItems/sewingItemsShared';
import OrderStagesDiagram from '@/components/crm/sewingItems/OrderStagesDiagram';
import { formatQuantity } from '@/lib/formatQuantity';

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
  onCut: (rollId?: number) => void;
  readOnly?: boolean;
  isCutterView?: boolean;
  isSewerView?: boolean;
  availableRolls?: Roll[];
  onSendToStickering?: (rollId?: number) => void;
  onCancelOrder?: () => void;
  cancelling?: boolean;
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
  isCutterView = false,
  isSewerView = false,
  availableRolls = [],
  onSendToStickering,
  onCancelOrder,
  cancelling = false,
}: SewingItemDetailDialogProps) => {
  const [selectedRollId, setSelectedRollId] = useState<string>('');
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const isAlreadyCut = selectedOrder?.sewingStatus === 'Раскроено';
  const isAlreadyStickering = selectedOrder?.sewingStatus === 'Стикеровка';
  // Тесьма нужна только если у товара задан требуемый материал тесьмы. Товары без тесьмы
  // швея отправляет на стикеровку без выбора рулона.
  const trimNeeded = orderDetail?.requiredTrimMaterialId != null;

  const canCancel =
    !!onCancelOrder &&
    ((isCutterView && selectedOrder?.sewingStatus === 'На раскрое') ||
      (isSewerView && selectedOrder?.sewingStatus === 'В работе'));

  const cancelTargetLabel = isCutterView ? '«Новый»' : '«Раскроено»';

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle>Товар #{selectedOrder?.id}</DialogTitle>
            {selectedOrder && <Badge variant="secondary">{selectedOrder.sewingStatus}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {canCancel && (
              <Button
                variant="outline"
                size="sm"
                className="w-fit text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setCancelConfirmOpen(true)}
                disabled={cancelling}
              >
                <Icon name="Ban" size={14} className="mr-1.5" />
                Отменить заказ
              </Button>
            )}
          </div>
        </DialogHeader>

        <AlertDialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Отменить заказ?</AlertDialogTitle>
              <AlertDialogDescription>
                Заказ будет отменён и вернётся во вкладку {cancelTargetLabel}, откуда его снова
                сможет взять в работу любой сотрудник в порядке очереди. Из системы заказ не пропадёт.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Не отменять</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  setCancelConfirmOpen(false);
                  onCancelOrder?.();
                }}
              >
                Отменить заказ
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {selectedOrder && (
          <div className="space-y-4">
            {!readOnly && isCutterView && (
              <Card className="border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">
                    Выбор рулона тюля
                    {orderDetail?.requiredFabricMaterialName && (
                      <span className="ml-1 font-normal text-muted-foreground">
                        — нужен материал «{orderDetail.requiredFabricMaterialName}»
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-end gap-3">
                  <div className="w-64 space-y-1.5">
                    <Label>Рулон в вашем цехе/смене</Label>
                    <Select value={selectedRollId} onValueChange={setSelectedRollId} disabled={cutting || isAlreadyCut}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите рулон" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableRolls.length === 0 ? (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет доступных рулонов</div>
                        ) : (
                          availableRolls.map((r) => (
                            <SelectItem key={r.id} value={String(r.id)}>
                              {r.materialName} #{r.barcode} — {formatQuantity(r.remainingQuantity)} {r.unit}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    onClick={() => onCut(selectedRollId ? Number(selectedRollId) : undefined)}
                    disabled={cutting || isAlreadyCut || !selectedRollId}
                  >
                    {cutting ? (
                      <>
                        <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
                        Списываем материалы...
                      </>
                    ) : (
                      <>
                        <Icon name="Scissors" size={16} className="mr-2" />
                        Раскроено
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}

            {!readOnly && isSewerView && (
              <Card className="border-border shadow-none">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">
                    Выбор рулона тесьмы
                    {orderDetail?.requiredTrimMaterialName && (
                      <span className="ml-1 font-normal text-muted-foreground">
                        — нужен материал «{orderDetail.requiredTrimMaterialName}»
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-end gap-3">
                  {trimNeeded ? (
                    <div className="w-64 space-y-1.5">
                      <Label>Рулон тесьмы в вашем цехе/смене</Label>
                      <Select
                        value={selectedRollId}
                        onValueChange={setSelectedRollId}
                        disabled={cutting || isAlreadyStickering}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Выберите рулон" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableRolls.length === 0 ? (
                            <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет доступных рулонов</div>
                          ) : (
                            availableRolls.map((r) => (
                              <SelectItem key={r.id} value={String(r.id)}>
                                {r.materialName} #{r.barcode} — {formatQuantity(r.remainingQuantity)} {r.unit}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Для этого товара тесьма не требуется — можно отправлять на стикеровку.
                    </p>
                  )}

                  <Button
                    onClick={() => onSendToStickering?.(selectedRollId ? Number(selectedRollId) : undefined)}
                    disabled={cutting || isAlreadyStickering || (trimNeeded && !selectedRollId)}
                  >
                    {cutting ? (
                      <>
                        <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
                        Списываем тесьму...
                      </>
                    ) : (
                      <>
                        <Icon name="Tag" size={16} className="mr-2" />
                        Отправить на стикеровку
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}

            {!readOnly && !isCutterView && !isSewerView && (
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

                  <Button onClick={() => onCut()} disabled={cutting || isAlreadyCut}>
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
                            {formatQuantity(mu.quantity)} {mu.unit}
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
                <CardContent className="space-y-3">
                  <OrderStagesDiagram order={selectedOrder} />
                  <Table>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-medium text-muted-foreground">Назначен сейчас</TableCell>
                        <TableCell>{selectedOrder.assignedUserName || '—'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-medium text-muted-foreground">Вешалка</TableCell>
                        <TableCell>{selectedOrder.hangerNumber > 0 ? `№ ${selectedOrder.hangerNumber}` : '—'}</TableCell>
                      </TableRow>
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