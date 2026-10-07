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
import type { Shipment } from '@/lib/shipmentsApi';
import SuppliesCards from '@/components/crm/shipments/SuppliesCards';

interface SuppliesTableProps {
  loading: boolean;
  /** FRONTEND-ONLY: сбой GET — не писать «приёмок пока нет». */
  error?: string | null;
  shipments: Shipment[];
  isAdmin: boolean;
  /** Кладовщик: правит и печатает стикеры, но не подтверждает приёмку. */
  canEditPending: boolean;
  onOpenReview: (shipmentId: number) => void;
  /** Открыть окно ввода логистики: сумму перевозки дописывают после приёмки. */
  onOpenLogistics: (shipmentId: number) => void;
  onPrintShipmentBarcodes: (shipmentId: number) => void;
  onPrintAcceptanceSheet: (shipmentId: number) => void;
  deleteId: number | null;
  deleting: boolean;
  onSetDeleteId: (id: number | null) => void;
  onDelete: () => void;
}

const SuppliesTable = ({
  loading,
  error = null,
  shipments,
  isAdmin,
  canEditPending,
  onOpenReview,
  onOpenLogistics,
  onPrintShipmentBarcodes,
  onPrintAcceptanceSheet,
  deleteId,
  deleting,
  onSetDeleteId,
  onDelete,
}: SuppliesTableProps) => {
  if (loading && shipments.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (shipments.length === 0) {
    if (error) return null;
    return <p className="text-sm text-muted-foreground">Приёмок пока нет</p>;
  }

  return (
    <>
      <SuppliesCards
        shipments={shipments}
        isAdmin={isAdmin}
        canEditPending={canEditPending}
        onOpenReview={onOpenReview}
        onOpenLogistics={onOpenLogistics}
        onPrintShipmentBarcodes={onPrintShipmentBarcodes}
        onPrintAcceptanceSheet={onPrintAcceptanceSheet}
        onSetDeleteId={onSetDeleteId}
      />

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
