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
import type { SupplyType } from '@/lib/marketplaceSuppliesApi';

interface ConfirmFbsSupplyDialogProps {
  pendingFbs: { marketplace: string; type: SupplyType } | null;
  setPendingFbs: (v: { marketplace: string; type: SupplyType } | null) => void;
  onConfirm: (marketplace: string, type: SupplyType) => void;
}

const ConfirmFbsSupplyDialog = ({
  pendingFbs,
  setPendingFbs,
  onConfirm,
}: ConfirmFbsSupplyDialogProps) => (
  <AlertDialog open={!!pendingFbs} onOpenChange={(v) => !v && setPendingFbs(null)}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Поставка попадёт в задания смены</AlertDialogTitle>
        <AlertDialogDescription>
          Новая поставка {pendingFbs?.marketplace} FBS добавится в ваш список
          заданий на сегодня. Пока вы её не отгрузите, закрыть смену не
          получится — иначе собранная поставка останется до завтра, а
          маркетплейс ждёт её сегодня.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Отмена</AlertDialogCancel>
        <AlertDialogAction
          onClick={() => {
            const p = pendingFbs;
            setPendingFbs(null);
            if (p) onConfirm(p.marketplace, p.type);
          }}
        >
          Создать поставку
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default ConfirmFbsSupplyDialog;
