import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
import Icon from '@/components/ui/icon';
import type { Shipment, ShipmentDetail } from '@/lib/shipmentsApi';
import { printBarcodes } from '@/lib/printBarcodes';
import { formatDate, statusVariant } from '@/components/crm/shipments/fromSupplierShared';
import { formatQuantity } from '@/lib/formatQuantity';

interface SuppliesTableProps {
  loading: boolean;
  shipments: Shipment[];
  isAdmin: boolean;
  expandedRolls: Record<number, ShipmentDetail | null>;
  loadingRolls: number | null;
  onToggleRolls: (shipmentId: number) => void;
  onOpenReview: (shipmentId: number) => void;
  onPrintShipmentBarcodes: (shipmentId: number) => void;
  deleteId: number | null;
  deleting: boolean;
  onSetDeleteId: (id: number | null) => void;
  onDelete: () => void;
}

const SuppliesTable = ({
  loading,
  shipments,
  isAdmin,
  expandedRolls,
  loadingRolls,
  onToggleRolls,
  onOpenReview,
  onPrintShipmentBarcodes,
  deleteId,
  deleting,
  onSetDeleteId,
  onDelete,
}: SuppliesTableProps) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (shipments.length === 0) {
    return <p className="text-sm text-muted-foreground">Приёмок пока нет</p>;
  }

  return (
    <>
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="text-primary-foreground">#</TableHead>
              <TableHead className="text-primary-foreground">Материалы</TableHead>
              <TableHead className="text-primary-foreground">Статус</TableHead>
              <TableHead className="text-primary-foreground">Кладовщик</TableHead>
              <TableHead className="text-primary-foreground">Поставщик</TableHead>
              <TableHead className="text-primary-foreground">Комментарий</TableHead>
              <TableHead className="text-primary-foreground">Создано</TableHead>
              <TableHead className="text-primary-foreground">Принято</TableHead>
              <TableHead className="text-primary-foreground"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shipments.map((s) => {
              const detail = expandedRolls[s.id];
              const isExpanded = s.id in expandedRolls;
              const isPending = s.status === 'Новый';
              return (
                  <TableRow key={s.id}>
                    <TableCell>{s.id}</TableCell>
                    <TableCell>
                      <div className="mb-1 font-semibold">
                        Итого: {s.itemsCount} поз., {formatQuantity(s.totalQuantity)} метр/шт
                      </div>
                      {!isPending && (
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
                              {loadingRolls === s.id ? 'Загрузка...' : `Показать рулоны (${s.itemsCount})`}
                            </Button>
                          </CollapsibleTrigger>
                          <CollapsibleContent className="mt-1.5 space-y-1">
                            {detail?.items.map((item) => (
                              <div key={item.id} className="flex items-center gap-1.5 text-xs">
                                <span className="font-medium">{item.materialName}</span>
                                <span className="text-muted-foreground">
                                  — {formatQuantity(item.quantity)} {item.unit}
                                </span>
                                {item.barcode && (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="icon"
                                      className="h-5 w-5"
                                      onClick={() => printBarcodes([{ code: item.barcode as string, label: `${item.materialName} — ${formatQuantity(item.quantity)} ${item.unit || ''}` }], item.barcode as string)}
                                    >
                                      <Icon name="Barcode" size={11} />
                                    </Button>
                                    <span className="font-mono-tech text-muted-foreground">
                                      ({item.barcode})
                                    </span>
                                  </>
                                )}
                              </div>
                            ))}
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[s.status] || 'secondary'}>
                        {s.status === 'Новый' ? 'Ожидает подтверждения' : s.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{s.createdByName || '—'}</TableCell>
                    <TableCell>{s.supplierName || '—'}</TableCell>
                    <TableCell>{s.comment || '—'}</TableCell>
                    <TableCell>{formatDate(s.createdAt)}</TableCell>
                    <TableCell>{s.completedAt ? formatDate(s.completedAt) : '—'}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {isPending && isAdmin && (
                          <Button size="sm" onClick={() => onOpenReview(s.id)}>
                            <Icon name="ClipboardCheck" size={14} className="mr-1" />
                            Проверить
                          </Button>
                        )}
                        {!isPending && (
                          <Button variant="outline" size="icon" onClick={() => onPrintShipmentBarcodes(s.id)}>
                            <Icon name="Barcode" size={14} />
                          </Button>
                        )}
                        {isAdmin && (
                          <Button variant="ghost" size="icon" onClick={() => onSetDeleteId(s.id)}>
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
            <AlertDialogTitle>Удалить приёмку от поставщика?</AlertDialogTitle>
            <AlertDialogDescription>
              Если поставка уже подтверждена — созданные рулоны удалятся вместе с ней, но
              только если они ещё не использованы (не списаны, не переданы в цех). Если хотя
              бы один рулон уже тронут — удаление будет отклонено. Действие нельзя отменить.
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

export default SuppliesTable;