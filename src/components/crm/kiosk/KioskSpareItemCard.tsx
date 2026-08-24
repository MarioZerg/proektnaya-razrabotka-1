import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { SpareItemError } from '@/lib/kioskApi';

interface Props {
  spare: SpareItemError['order'];
  storingSpare: boolean;
  onStore: () => void;
  onCancel: () => void;
}

/**
 * Вещь по УЖЕ ЗАКРЫТОМУ заказу, оставшаяся на руках у упаковщицы.
 *
 * Заказ закрыли вещью с полки, а швея тем временем дошила свою. Покупателю она
 * уже не поедет, но это готовый товар — предлагаем сдать его на склад как
 * свободный остаток, а не бросать в цехе.
 */
const KioskSpareItemCard = ({ spare, storingSpare, onStore, onCancel }: Props) => (
  <Card className="border-amber-300 bg-amber-50 shadow-none">
    <CardContent className="space-y-3 pt-6 text-center">
      <p className="text-lg font-bold text-amber-900">Заказ уже закрыт</p>
      <p className="text-sm text-amber-900">
        Заказ {spare.orderNumber} закрыли вещью со склада, покупателю эта вещь уже не
        поедет. Сдайте её на склад — она пойдёт на следующий такой же заказ
      </p>
      <p className="text-sm font-semibold text-amber-900">
        {spare.material} {spare.width}×{spare.height}
      </p>
      <Button
        size="lg"
        className="h-16 w-full bg-amber-600 text-lg text-white hover:bg-amber-700"
        onClick={onStore}
        disabled={storingSpare}
      >
        <Icon
          name={storingSpare ? 'Loader2' : 'PackagePlus'}
          size={24}
          className={`mr-2 ${storingSpare ? 'animate-spin' : ''}`}
        />
        Сдать на склад со стикером хранения
      </Button>
      <Button variant="outline" size="lg" className="h-14 w-full" onClick={onCancel}>
        Отмена
      </Button>
    </CardContent>
  </Card>
);

export default KioskSpareItemCard;
