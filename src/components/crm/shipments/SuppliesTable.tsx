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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import type { Shipment } from '@/lib/shipmentsApi';
import { formatDate, statusVariant } from '@/components/crm/shipments/fromSupplierShared';
import { formatQuantity } from '@/lib/formatQuantity';

interface SuppliesTableProps {
  loading: boolean;
  shipments: Shipment[];
  isAdmin: boolean;
  /** Кладовщик: правит и печатает стикеры, но не подтверждает приёмку. */
  canEditPending: boolean;
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
  canEditPending,
  onOpenReview,
  onPrintShipmentBarcodes,
  deleteId,
  deleting,
  onSetDeleteId,
  onDelete,
}: SuppliesTableProps) => {
  const navigate = useNavigate();
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
              const isPending = s.status === 'Новый';
              return (
                  <TableRow key={s.id}>
                    <TableCell>{s.id}</TableCell>
                    <TableCell>
                      <div className="mb-1 font-semibold">
                        Итого: {s.itemsCount} поз., {formatQuantity(s.totalQuantity)} метр/шт
                      </div>
                      {/* Раньше рулоны раскрывались мелкой гармошкой прямо в списке:
                          на 284 позиции это нечитаемо. Теперь ведём на страницу приёмки —
                          там поиск по штрихкоду и печать стикера по одному рулону. */}
                      {!isPending && (
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto px-0 py-0 text-xs"
                          onClick={() => navigate(`/crm/shipments/from-supplier/${s.id}`)}
                        >
                          <Icon name="ChevronRight" size={12} className="mr-1" />
                          Открыть рулоны ({s.itemsCount})
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[s.status] || 'secondary'}>
                        {s.status === 'Новый' ? 'Ожидает подтверждения' : s.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{s.createdByName || '—'}</TableCell>
                    <TableCell>
                      {s.itemSuppliers || s.supplierName || '—'}
                    </TableCell>
                    <TableCell>{s.comment || '—'}</TableCell>
                    <TableCell>{formatDate(s.createdAt)}</TableCell>
                    <TableCell>{s.completedAt ? formatDate(s.completedAt) : '—'}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {/* Админ проверяет и подтверждает, кладовщик — правит свой же
                            состав, пока приёмку не приняли. */}
                        {isPending && (isAdmin || canEditPending) && (
                          <Button
                            size="sm"
                            variant={isAdmin ? 'default' : 'outline'}
                            onClick={() => onOpenReview(s.id)}
                          >
                            <Icon
                              name={isAdmin ? 'ClipboardCheck' : 'Pencil'}
                              size={14}
                              className="mr-1"
                            />
                            {isAdmin ? 'Проверить' : 'Изменить'}
                          </Button>
                        )}
                        {/* Печать стикеров доступна сразу: коды выдаются при оформлении,
                            и кладовщик клеит их прямо при разгрузке машины. */}
                        <Button
                          variant="outline"
                          size="icon"
                          title="Печать стикеров рулонов (75×120 мм)"
                          onClick={() => onPrintShipmentBarcodes(s.id)}
                        >
                          <Icon name="Barcode" size={14} />
                        </Button>
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