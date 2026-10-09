import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import type { ShopItem } from '@/lib/varikiApi';
import { isBubbleCase, todayIso } from '@/components/crm/variki/shop/varikiShopUtils';

interface BuyConfirmDialogProps {
  confirmItem: ShopItem | null;
  visitDate: string;
  buying: boolean;
  onVisitDateChange: (v: string) => void;
  onClose: () => void;
  onBuy: () => void;
}

/** Подтверждение покупки; для подарков с записью — выбор даты посещения. */
const BuyConfirmDialog = ({
  confirmItem,
  visitDate,
  buying,
  onVisitDateChange,
  onClose,
  onBuy,
}: BuyConfirmDialogProps) => (
  <AlertDialog
    open={!!confirmItem}
    onOpenChange={(v) => {
      if (!v) onClose();
    }}
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Купить за {confirmItem?.price} вариков?</AlertDialogTitle>
        <AlertDialogDescription>
          {confirmItem?.title}. Варики спишутся сразу.{' '}
          {confirmItem && isBubbleCase(confirmItem)
            ? 'Откроется случайная шляпа на вашем пузырьке. Если уже была шляпа — она пропадёт, останется новая.'
            : confirmItem?.needsVisitDate
              ? 'Администратор забронирует место на выбранный день и пришлёт сертификат сюда.'
              : confirmItem && confirmItem.available > 0
                ? 'Сертификат вы получите тут же — ждать не нужно.'
                : 'Купон пришлёт администратор — он появится на этой странице.'}
        </AlertDialogDescription>
      </AlertDialogHeader>

      {/* Дата посещения. Для таких подарков место бронируется под конкретный
          день, поэтому без даты покупку не пропускаем. */}
      {confirmItem?.needsVisitDate && (
        <div className="space-y-1.5">
          <Label>Когда хотите посетить?</Label>
          <Input
            type="date"
            value={visitDate}
            min={todayIso()}
            max={confirmItem.validTo || undefined}
            onChange={(e) => onVisitDateChange(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Если на этот день не получится забронировать, администратор
            свяжется с вами
          </p>
        </div>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={buying}>Отмена</AlertDialogCancel>
        <AlertDialogAction
          onClick={onBuy}
          disabled={buying || (!!confirmItem?.needsVisitDate && !visitDate)}
        >
          {buying ? 'Покупаем...' : 'Купить'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

export default BuyConfirmDialog;
