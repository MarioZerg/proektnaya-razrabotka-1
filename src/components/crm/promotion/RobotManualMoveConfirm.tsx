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
  catalogTitle,
  formatRub,
  raisedPrice,
} from '@/components/crm/promotion/raiseShared';
import type { CatalogItem } from '@/lib/priceRobotApi';

/**
 * Подтверждение подъёма: сколько карточек, на сколько, примеры цен.
 * Логика 1:1 перенесена из RobotManualMove.
 */
interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pickedItems: CatalogItem[];
  value: number;
  scope: string;
  note: string;
  onConfirm: () => void;
}

const RobotManualMoveConfirm = ({
  open,
  onOpenChange,
  pickedItems,
  value,
  scope,
  note,
  onConfirm,
}: Props) => {
  const examples = pickedItems.slice(0, 5);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Поднять {pickedItems.length} карточек на {value}%?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left text-sm text-muted-foreground">
              <p>
                Цены уйдут на витрину сразу. {scope}.
                {note ? ` Причина: ${note}.` : ''}
              </p>
              <ul className="space-y-1">
                {examples.map((i) => (
                  <li key={i.itemId} className="tabular-nums">
                    {catalogTitle(i)}:{' '}
                    {formatRub(i.price)} → {formatRub(raisedPrice(i.price, value))}
                  </li>
                ))}
              </ul>
              {pickedItems.length > examples.length && (
                <p>и ещё {pickedItems.length - examples.length}</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Поднять цены
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default RobotManualMoveConfirm;
