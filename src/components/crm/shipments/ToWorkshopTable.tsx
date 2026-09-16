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
import { formatDate, statusStyle, shiftLabel } from '@/components/crm/shipments/toWorkshopShared';
import { formatQuantity } from '@/lib/formatQuantity';
import ToWorkshopCards from '@/components/crm/shipments/ToWorkshopCards';

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

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (shipments.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
        <Icon name="Factory" size={28} className="mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium">Заявок пока нет</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Когда цех запросит материал, заявка появится здесь
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="md:hidden">
        <ToWorkshopCards
          shipments={shipments}
          workshops={workshops}
          zone={zone}
          userWorkshopId={userWorkshopId}
          userShiftNumber={userShiftNumber}
          expandedRolls={expandedRolls}
          loadingRolls={loadingRolls}
          onToggleRolls={onToggleRolls}
          onOpenShipment={onOpenShipment}
          onOpenReceiveDialog={onOpenReceiveDialog}
          onSetDeleteId={onSetDeleteId}
        />
      </div>
      {/* Таблица без горизонтальной прокрутки: связанные поля собраны в одну ячейку,
          как у приёмки от поставщика. Раньше девять колонок уезжали за край. */}
      <div className="hidden min-w-0 overflow-hidden rounded-md border border-border md:block">
        <Table className="min-w-0 table-fixed">
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="w-[30%] whitespace-normal text-primary-foreground">Заявка</TableHead>
              <TableHead className="w-[16%] whitespace-normal text-primary-foreground">Статус</TableHead>
              <TableHead className="w-[18%] whitespace-normal text-primary-foreground">Куда</TableHead>
              <TableHead className="w-[16%] whitespace-normal text-primary-foreground">Кто</TableHead>
              <TableHead className="w-[20%] whitespace-normal text-primary-foreground" />
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
                  <TableCell className="whitespace-normal break-words align-top">
                    <div className="font-semibold">#{s.id}</div>
                    <div className="break-words text-sm">{s.materialNames || '—'}</div>
                    {s.comment ? (
                      <div className="mt-1 break-words text-xs text-muted-foreground">{s.comment}</div>
                    ) : null}
                    {canExpand && (
                      <Collapsible open={isExpanded}>
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="link"
                            size="sm"
                            className="mt-1 h-auto px-0 py-0 text-xs"
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
                                  — {item.materialName}, {formatQuantity(item.quantity)} {item.unit}
                                </span>
                              </div>
                            ))}
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal align-top">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className={statusStyle(s.status, needsCorrection)}>
                        {needsCorrection ? 'Нужна правка' : s.status}
                      </Badge>
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
                  <TableCell className="whitespace-normal break-words align-top">
                    <div>{s.workshopName || '—'}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {shiftLabel(workshops, s.workshopId, s.shiftNumber)}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal align-top text-xs">
                    <div>{s.requestedByName || '—'}</div>
                    <div className="mt-0.5 text-muted-foreground">{formatDate(s.createdAt)}</div>
                  </TableCell>
                  <TableCell className="min-w-0 align-top">
                    <div className="flex min-w-0 flex-wrap justify-end gap-1">
                      {canAssemble && s.status === 'Новый' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="px-2 lg:px-3"
                          onClick={() => onOpenShipment(s.id)}
                        >
                          <Icon name="ScanLine" size={14} className="lg:mr-1" />
                          <span className="hidden lg:inline">Собрать</span>
                        </Button>
                      )}
                      {canAssemble && needsCorrection && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="px-2 lg:px-3"
                          onClick={() => onOpenShipment(s.id)}
                        >
                          <Icon name="Wrench" size={14} className="lg:mr-1" />
                          <span className="hidden lg:inline">Исправить</span>
                        </Button>
                      )}
                      {s.status === 'Отправлено' && canReceive(s) && (
                        <Button size="sm" className="px-2 lg:px-3" onClick={() => onOpenReceiveDialog(s.id)}>
                          <Icon name="PackageCheck" size={14} className="lg:mr-1" />
                          <span className="hidden lg:inline">Принять</span>
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
