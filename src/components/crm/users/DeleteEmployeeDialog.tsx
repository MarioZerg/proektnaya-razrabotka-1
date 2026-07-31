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

interface DeleteEmployeeDialogProps {
  deleteId: number | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

const DeleteEmployeeDialog = ({ deleteId, onOpenChange, onConfirm }: DeleteEmployeeDialogProps) => {
  return (
    <AlertDialog open={deleteId !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить сотрудника?</AlertDialogTitle>
          <AlertDialogDescription>Доступ в систему будет отозван.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Удалить</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default DeleteEmployeeDialog;
