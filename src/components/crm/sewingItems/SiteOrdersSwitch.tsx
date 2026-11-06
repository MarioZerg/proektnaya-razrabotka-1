import Icon from '@/components/ui/icon';

interface SiteOrdersSwitchProps {
  /** Сколько вещей сейчас на конвейере (маркетплейсы и интернет-магазин вместе). */
  conveyorCount: number;
}

/**
 * Шапка конвейера: одна вкладка «Конвейер» для всех заказов — маркетплейсов и
 * интернет-магазина мегатюль.рф. Заказы сайта забирает расписание на сервере,
 * ручной кнопки больше нет.
 */
const SiteOrdersSwitch = ({ conveyorCount }: SiteOrdersSwitchProps) => (
  <div className="flex flex-wrap items-center gap-2">
    <span className="flex items-center gap-2 rounded-lg border border-primary bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
      <Icon name="Workflow" fallback="ShoppingBag" size={15} />
      Конвейер
      <span className="rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-bold">
        {conveyorCount}
      </span>
    </span>
  </div>
);

export default SiteOrdersSwitch;
