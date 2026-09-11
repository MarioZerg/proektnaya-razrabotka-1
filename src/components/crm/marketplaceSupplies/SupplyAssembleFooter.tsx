import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

interface SupplyAssembleFooterProps {
  /** Непустые короба, которые ещё не заклеены. */
  openBoxes: number;
  totalBoxedItems: number;
  completing: boolean;
  onSupplyAssembled: () => void;
}

/**
 * ПОСТАВКА СОБРАНА — последний шаг кладовщика.
 *
 * Появляется, когда все короба заклеены: дальше поставка уходит в отгрузку,
 * и вещи в неё уже не добавляют. Раньше кладовщик закрывал короба и не понимал,
 * что делать дальше — статус приходилось менять менеджеру из списка поставок.
 */
const SupplyAssembleFooter = ({
  openBoxes,
  totalBoxedItems,
  completing,
  onSupplyAssembled,
}: SupplyAssembleFooterProps) => (
  <div className="rounded-lg border border-border bg-muted/40 p-4">
    {openBoxes > 0 ? (
      <p className="text-sm text-muted-foreground">
        <Icon name="Info" size={14} className="mr-1.5 inline" />
        Закройте все короба — осталось открытых: <b>{openBoxes}</b>
      </p>
    ) : (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Все короба закрыты</p>
          <p className="text-sm text-muted-foreground">
            В коробах {totalBoxedItems} шт. После подтверждения поставка
            уйдёт в отгрузку — добавить вещи будет нельзя
          </p>
        </div>
        <Button onClick={onSupplyAssembled} disabled={completing}>
          <Icon
            name={completing ? 'Loader2' : 'CircleCheck'}
            size={16}
            className={`mr-1.5 ${completing ? 'animate-spin' : ''}`}
          />
          Поставка собрана
        </Button>
      </div>
    )}
  </div>
);

export default SupplyAssembleFooter;
