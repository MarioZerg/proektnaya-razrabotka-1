import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

interface SupplyAssembleFooterProps {
  /** Непустые короба, которые ещё не заклеены. */
  openBoxes: number;
  totalBoxedItems: number;
  /** Сколько штук обещано маркетплейсу по заявке. null — план не задан. */
  plannedItems?: number | null;
  completing: boolean;
  onSupplyAssembled: () => void;
}

/**
 * ПОСТАВКА СОБРАНА — последний шаг кладовщика.
 *
 * КНОПКА ПОД ЗАМКОМ, ПОКА ПОСТАВКА НЕ СОБРАНА ЦЕЛИКОМ.
 *
 * Раньше она загоралась, едва закрыли короба, — не глядя на то, сколько вещей
 * реально уложено. Кладовщик закрывал два короба из двадцати, жал «собрана», и
 * поставка уходила в отгрузку: на площадку ехал недовоз, а остаток товара
 * зависал на складе до следующей заявки.
 *
 * Теперь условий два, и оба видны человеку:
 *   1. в коробах лежит всё, что обещано заявке (или менеджер уменьшил заявку);
 *   2. все непустые короба заклеены — иначе на OZON нет грузоместа.
 */
const SupplyAssembleFooter = ({
  openBoxes,
  totalBoxedItems,
  plannedItems,
  completing,
  onSupplyAssembled,
}: SupplyAssembleFooterProps) => {
  // План может быть не задан (ручная поставка) — тогда по количеству не судим.
  const hasPlan = typeof plannedItems === 'number' && plannedItems > 0;
  const missing = hasPlan ? Math.max(0, plannedItems - totalBoxedItems) : 0;
  const blocked = missing > 0 || openBoxes > 0;

  return (
    <div
      className={`rounded-lg border p-4 ${
        blocked ? 'border-amber-300 bg-amber-50' : 'border-border bg-muted/40'
      }`}
    >
      {blocked ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 font-medium text-amber-900">
            <Icon name="Lock" size={16} />
            Поставку закрывать рано
          </p>
          <ul className="space-y-1 text-sm text-amber-900">
            {missing > 0 && (
              <li className="flex items-start gap-2">
                <Icon name="Package" size={14} className="mt-0.5 shrink-0" />
                <span>
                  Уложено <b>{totalBoxedItems}</b> из <b>{plannedItems}</b> шт. по
                  заявке — не хватает <b>{missing}</b>. Дособерите товар или
                  попросите менеджера уменьшить состав заявки
                </span>
              </li>
            )}
            {openBoxes > 0 && (
              <li className="flex items-start gap-2">
                <Icon name="PackageOpen" size={14} className="mt-0.5 shrink-0" />
                <span>
                  Не закрыты короба: <b>{openBoxes}</b>. Закройте их — грузоместо на
                  OZON создаётся только при закрытии короба
                </span>
              </li>
            )}
          </ul>
          {/* Кнопку показываем всегда, но заблокированной: человек должен видеть,
              что шаг есть и почему он недоступен, а не искать пропавшую кнопку. */}
          <Button disabled className="mt-1">
            <Icon name="Lock" size={16} className="mr-1.5" />
            Поставка собрана
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">Поставка собрана полностью</p>
            <p className="text-sm text-muted-foreground">
              В коробах {totalBoxedItems} шт.
              {hasPlan ? ` из ${plannedItems} по заявке.` : '.'} После подтверждения
              поставка уйдёт в отгрузку, менеджер получит уведомление, а добавить
              вещи будет нельзя
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
};

export default SupplyAssembleFooter;
