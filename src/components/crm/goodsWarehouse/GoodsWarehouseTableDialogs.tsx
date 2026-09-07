import { Textarea } from '@/components/ui/textarea';
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

interface GoodsWarehouseTableDialogsProps {
  lostId: number | null;
  setLostId: (id: number | null) => void;
  lostReason: string;
  setLostReason: (reason: string) => void;
  saving: boolean;
  onConfirmLost: () => void;
  deleteId: number | null;
  setDeleteId: (id: number | null) => void;
  deleting: boolean;
  onConfirmDelete: () => void;
}

/** Подтверждения по вещи склада: отметить утерянной и удалить из учёта. */
const GoodsWarehouseTableDialogs = ({
  lostId,
  setLostId,
  lostReason,
  setLostReason,
  saving,
  onConfirmLost,
  deleteId,
  setDeleteId,
  deleting,
  onConfirmDelete,
}: GoodsWarehouseTableDialogsProps) => {
  return (
    <>
      <AlertDialog open={lostId !== null} onOpenChange={(open) => !open && setLostId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отметить товар утерянным?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Товар выбывает из активных статусов склада. Укажите причину:</p>
                <Textarea
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  placeholder="Причина утери"
                  rows={2}
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmLost} disabled={saving || !lostReason.trim()}>
              {saving ? 'Сохранение...' : 'Отметить утерянным'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Удаление со склада: вещь исчезает из учёта совсем, поэтому спрашиваем
          подтверждение — вернуть её можно будет только новой приёмкой. */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить товар со склада?</AlertDialogTitle>
            <AlertDialogDescription>
              Запись пропадёт из учёта. Если вещь физически на месте, вернуть её можно
              будет только новой приёмкой.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmDelete} disabled={deleting}>
              {deleting ? 'Удаление...' : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default GoodsWarehouseTableDialogs;
