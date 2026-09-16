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
import { marketplaceLogo } from '@/components/crm/orders/ordersShared';
import type { Order } from '@/lib/ordersApi';

/**
 * Подтверждения снятия заказа с конвейера и возврата его в работу.
 * Тексты и поведение 1:1 перенесены из MarketplaceOrders.
 */
interface Props {
  deleteTarget: Order | null;
  setDeleteTarget: (o: Order | null) => void;
  deleting: boolean;
  onDelete: () => void;
  restoreTarget: Order | null;
  setRestoreTarget: (o: Order | null) => void;
  restoring: boolean;
  onRestore: () => void;
}

const OrdersConfirmDialogs = ({
  deleteTarget,
  setDeleteTarget,
  deleting,
  onDelete,
  restoreTarget,
  setRestoreTarget,
  restoring,
  onRestore,
}: Props) => (
  <>
    {/* Подтверждение снятия: говорим прямым текстом, что заказ отменится и на
        площадке — это то, чего нельзя отыграть назад. */}
    <AlertDialog
      open={!!deleteTarget}
      onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Снять заказ с конвейера?</AlertDialogTitle>
          <AlertDialogDescription>
            Заказ {deleteTarget?.orderNumber} будет отменён на маркетплейсе{' '}
            {deleteTarget ? marketplaceLogo[deleteTarget.marketplace]?.label || deleteTarget.marketplace : ''}{' '}
            по API и скрыт из списка заказов. Найти его потом можно фильтром «Отменённые».
          </AlertDialogDescription>
          <AlertDialogDescription className="font-medium text-destructive">
            Отмену на площадке отыграть назад нельзя. Если маркетплейс отмену не примет,
            заказ останется на конвейере и вы увидите его ответ.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Не снимать</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={deleting}
            onClick={(e) => {
              // Диалог закрываем сами — только после ответа сервера: иначе админ
              // не увидит, что отмена на площадке не прошла.
              e.preventDefault();
              onDelete();
            }}
          >
            {deleting && <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />}
            Снять и отменить
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    {/* Возврат в работу: заказ снова поедет по цеху и на него спишут ткань,
        поэтому спрашиваем подтверждение, как и при снятии. */}
    <AlertDialog
      open={!!restoreTarget}
      onOpenChange={(open) => !open && !restoring && setRestoreTarget(null)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Вернуть заказ в работу?</AlertDialogTitle>
          <AlertDialogDescription>
            Заказ {restoreTarget?.orderNumber} вернётся в самое начало конвейера — этап
            «Новый», без закройщика и цеха. Его снова возьмут в раскрой и отошьют.
          </AlertDialogDescription>
          <AlertDialogDescription>
            На маркетплейсе при этом ничего не меняется: вернуть можно только заказ,
            который сняли мы сами. Если отмену сделала площадка, сервер откажет —
            отправления там больше нет и отгружать вещь некуда.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={restoring}>Не возвращать</AlertDialogCancel>
          <AlertDialogAction
            disabled={restoring}
            onClick={(e) => {
              // Закрываем диалог сами, после ответа сервера: отказ («отменил
              // маркетплейс») админ должен увидеть, а не гадать.
              e.preventDefault();
              onRestore();
            }}
          >
            {restoring && <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />}
            Вернуть в работу
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
);

export default OrdersConfirmDialogs;
