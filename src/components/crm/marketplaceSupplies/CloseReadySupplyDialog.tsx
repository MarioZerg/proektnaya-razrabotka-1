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
import type { Supply } from '@/lib/marketplaceSuppliesApi';

const CloseReadySupplyDialog = ({
  closeToCreate,
  setCloseToCreate,
  onConfirm,
}: {
  closeToCreate: Supply | null;
  setCloseToCreate: (v: Supply | null) => void;
  onConfirm: () => void;
}) => (
  <AlertDialog open={!!closeToCreate} onOpenChange={(v) => !v && setCloseToCreate(null)}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Закрыть прошлую поставку?</AlertDialogTitle>
        <AlertDialogDescription>
          {closeToCreate?.supplyNumber || 'Поставка'} отсканирована целиком и сама
          закроется через 12 часов. Закройте её сейчас — и можно создать новую.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Отмена</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>Закрыть и создать</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default CloseReadySupplyDialog;
