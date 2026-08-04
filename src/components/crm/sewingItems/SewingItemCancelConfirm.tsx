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

interface SewingItemCancelConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cancelTargetLabel: string;
  onConfirm: () => void;
}

const SewingItemCancelConfirm = ({
  open,
  onOpenChange,
  cancelTargetLabel,
  onConfirm,
}: SewingItemCancelConfirmProps) => {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
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
            onClick={onConfirm}
          >
            Отменить заказ
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default SewingItemCancelConfirm;
