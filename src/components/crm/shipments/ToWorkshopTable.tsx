import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { Shipment, ShipmentDetail } from '@/lib/shipmentsApi';
import type { Workshop } from '@/lib/workshopsApi';
import type { AccessZone } from '@/lib/roles';
import { formatDate, statusVariant, shiftLabel } from '@/components/crm/shipments/toWorkshopShared';

interface ToWorkshopTableProps {
  loading: boolean;
  shipments: Shipment[];
  workshops: Workshop[];
  zone: AccessZone;
  userWorkshopId: number | null;
  userShiftNumber: number | null;
  expandedRolls: Record<number, ShipmentDetail | null>;
  loadingRolls: number | null;
  onToggleRolls: (shipmentId: number) => void;
  deleteId: number | null;
  deleting: boolean;
  onOpenShipment: (id: number) => void;
  onOpenReceiveDialog: (id: number) => void;
  onSetDeleteId: (id: number | null) => void;
  onDelete: () => void;
}

const ToWorkshopTable = ({
  loading,
  shipments,
  workshops,
  zone,
  userWorkshopId,
  userShiftNumber,
  expandedRolls,
  loadingRolls,
  onToggleRolls,
  deleteId,
  deleting,
  onOpenShipment,
  onOpenReceiveDialog,
  onSetDeleteId,
  onDelete,
}: ToWorkshopTableProps) => {
  // Собирает и отправляет рулоны только зона склада (кладовщик) — админ тоже может, для
  // исправления ошибок. Работники цехов (зона workshop) эту кнопку не видят вообще.
  const canAssemble = zone === 'admin' || zone === 'warehouse';

  // Принять в цехе может только сам работник СВОЕГО цеха/смены — кладовщик эту кнопку
  // больше не видит вообще (не его зона ответственности). Админ видит всегда — для
  // исправления ошибок.
  const canReceive = (s: Shipment) =>
    zone === 'admin' ||
    (zone === 'workshop' && s.workshopId === userWorkshopId && (s.shiftNumber === null || s.shiftNumber === userShiftNumber));

  return (
    <>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      ) : shipments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Заявок пока нет</p>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-primary hover:bg-primary">
                <TableHead className="text-primary-foreground">#</TableHead>
                <TableHead className="text-primary-foreground">Материал</TableHead>
                <TableHead className="text-primary-foreground">Статус</TableHead>
                <TableHead className="text-primary-foreground">Цех</TableHead>
                <TableHead className="text-primary-foreground">Смена</TableHead>
                <TableHead className="text-primary-foreground">Запросил</TableHead>
                <TableHead className="text-primary-foreground">Комментарий</TableHead>
                <TableHead className="text-primary-foreground">Создано</TableHead>
                <TableHead className="text-primary-foreground" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipments.map((s) => {
                const detail = expandedRolls[s.id];
                const isExpanded = s.id in expandedRolls;
                const canExpand = s.status === 'Отправлено' || s.status === 'Получено';
                const needsCorrection = s.status === 'Отправлено' && !!s.rejectReason;
                return (
                  <TableRow key={s.id}>
                    <TableCell>{s.id}</TableCell>
                    <TableCell>
                      <div>{s.materialNames || '—'}</div>
                      {canExpand && (
                        <Collapsible open={isExpanded}>
                          <CollapsibleTrigger asChild>
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto px-0 py-0 text-xs"
                              onClick={() => onToggleRolls(s.id)}
                              disabled={loadingRolls === s.id}
                            >
                              <Icon
                                name={isExpanded ? 'ChevronDown' : 'ChevronRight'}
                                size={12}
                                className="mr-1"
                              />
                              {loadingRolls === s.id ? 'Загрузка...' : 'Показать рулоны'}
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-1.5 space-y-1">
                            {detail?.items
                              .filter((item) => item.rollId !== null)
                              .map((item) => (
                                <div key={item.id} className="text-xs">
                                  <span className="font-mono-tech font-medium">{item.rollBarcode}</span>
                                  <span className="text-muted-foreground">
                                    {' '}
                                    — {item.materialName}, {item.quantity} {item.unit}
                                  </span>
                                </div>
                              ))}
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={statusVariant[s.status] || 'secondary'}>{s.status}</Badge>
                        {s.isAutoOrder && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Автозаказ
                          </Badge>
                        )}
                      </div>
                      {needsCorrection && (
                        <p className="mt-1 text-xs text-destructive">Отказано: {s.rejectReason}</p>
                      )}
                    </TableCell>
                    <TableCell>{s.workshopName || '—'}</TableCell>
                    <TableCell>{shiftLabel(workshops, s.workshopId, s.shiftNumber)}</TableCell>
                    <TableCell>{s.requestedByName || '—'}</TableCell>
                    <TableCell>{s.comment || '—'}</TableCell>
                    <TableCell>{formatDate(s.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {canAssemble && s.status === 'Новый' && (
                          <Button size="sm" variant="outline" onClick={() => onOpenShipment(s.id)}>
                            Собрать
                          </Button>
                        )}
                        {canAssemble && needsCorrection && (
                          <Button size="sm" variant="outline" onClick={() => onOpenShipment(s.id)}>
                            <Icon name="Wrench" size={14} className="mr-1" />
                            Исправить
                          </Button>
                        )}
                        {s.status === 'Отправлено' && canReceive(s) && (
                          <Button size="sm" onClick={() => onOpenReceiveDialog(s.id)}>
                            Принять в цехе
                          </Button>
                        )}
                        {zone === 'admin' && (s.status === 'Новый' || s.status === 'Отправлено') && (
                          <Button size="icon" variant="ghost" onClick={() => onSetDeleteId(s.id)}>
                            <Icon name="Trash2" size={14} />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && onSetDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить заявку на отгрузку в цех?</AlertDialogTitle>
            <AlertDialogDescription>
              Собранные рулоны (если есть) вернутся на склад. Если это был автозаказ —
              система не создаст новый автозаказ по этому материалу/цеху/смене, пока
              следующая заявка на эту же комбинацию не будет принята в цехе. Действие
              нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} disabled={deleting}>
              {deleting ? 'Удаление...' : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ToWorkshopTable;
