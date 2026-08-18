import Icon from '@/components/ui/icon';
import {
  zoneAccentClass,
  zoneBarClass,
  zoneLabels,
  zoneTextClass,
  zoneTileClass,
  type WorkZone,
} from '@/lib/workZone';

interface WorkTileProps {
  icon: string;
  title: string;
  /** Короткое пояснение: что именно попадает в этот счётчик. */
  hint: string;
  count: number;
  onClick: () => void;
  /** Чья это работа: цех, склад или передача между ними. Задаёт цвет плитки. */
  zone?: WorkZone;
  /** Подпись кнопки шага, который идёт ПЕРЕД этой плиткой (рисуется сверху со стрелкой). */
  stepLabel?: string;
  stepIcon?: string;
  /** Счётчик у верхнего шага: сколько вещей там ждёт работы. */
  stepCount?: number;
  onStep?: () => void;
  /** Третий шаг — ПОСЛЕ основного действия (рисуется снизу со стрелкой). */
  afterLabel?: string;
  afterIcon?: string;
  /** Счётчик у третьего шага: сколько вещей ждёт этого действия. */
  afterCount?: number;
  onAfter?: () => void;
}

/**
 * Плитка работы на складе: крупное число и понятное действие.
 *
 * Раньше все действия склада были одинаковыми кнопками в один ряд — десяток штук,
 * переносившихся на две-три строки. Кладовщик каждый раз читал их глазами, чтобы найти
 * нужную, и не видел главного: где сейчас есть работа, а где пусто.
 *
 * Здесь наоборот: если вещей ноль, плитка серая и в глаза не лезет; если работа есть —
 * подсвечивается и показывает количество крупно, видно с другого конца склада.
 */
const WorkTile = ({
  icon,
  title,
  hint,
  count,
  onClick,
  zone = 'warehouse',
  stepLabel,
  stepIcon,
  stepCount,
  onStep,
  afterLabel,
  afterIcon,
  afterCount,
  onAfter,
}: WorkTileProps) => {
  const active = count > 0;

  const tile = (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex w-full items-center gap-3 overflow-hidden rounded-lg border p-4 pl-5 text-left transition ${
        active ? zoneTileClass[zone] : 'border-border bg-card hover:bg-muted/50'
      }`}
      title={zoneLabels[zone]}
    >
      {/* Полоса зоны: фиолетовая — производство, зелёная — склад, двухцветная —
          передача между ними. Кладовщик видит свой участок работы, не читая. */}
      <span className={`absolute inset-y-0 left-0 w-1.5 ${zoneBarClass[zone]}`} />
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md ${
          active ? zoneAccentClass[zone] : 'bg-muted text-muted-foreground'
        }`}
      >
        <Icon name={icon} size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-tight">{title}</p>
        <p className="mt-0.5 text-xs leading-tight text-muted-foreground">{hint}</p>
      </div>
      <span
        className={`shrink-0 text-2xl font-bold ${
          active ? zoneTextClass[zone] : 'text-muted-foreground/50'
        }`}
      >
        {count}
      </span>
    </button>
  );

  // Шаг, который идёт ПОСЛЕ основного действия. Рисуется так же, как верхний,
  // но с меткой количества: кладовщик видит, ждёт ли его там работа.
  const afterStep = onAfter ? (
    <>
      <div className="flex justify-center py-0.5">
        <Icon name="ArrowDown" size={16} className="text-muted-foreground" />
      </div>
      <button
        type="button"
        onClick={onAfter}
        className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-violet-400 bg-card px-3 py-2 text-sm font-medium transition hover:bg-muted/50"
      >
        <Icon name={afterIcon || 'Warehouse'} size={16} className="text-violet-600" />
        <span className="text-center leading-tight">{afterLabel}</span>
        {afterCount ? (
          <span className="shrink-0 rounded-full bg-violet-600 px-2 py-0.5 text-xs font-bold text-white">
            {afterCount}
          </span>
        ) : null}
      </button>
    </>
  ) : null;

  if (!onStep) {
    if (!afterStep) return tile;
    return (
      <div className="flex flex-col">
        {tile}
        {afterStep}
      </div>
    );
  }

  // Двухуровневая плитка: сверху шаг, который делают ПЕРВЫМ, снизу — куда это ведёт.
  // Стрелка показывает порядок: сначала принял привезённое, потом разбираешь его.
  // Без такой связки кладовщик видел две отдельные кнопки и не понимал, что одна
  // наполняет другую.
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onStep}
        className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-emerald-400 bg-card px-3 py-2 text-sm font-medium transition hover:bg-muted/50"
      >
        <Icon name={stepIcon || 'PackageOpen'} size={16} className="text-emerald-600" />
        <span className="text-center leading-tight">{stepLabel}</span>
        {stepCount ? (
          <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">
            {stepCount}
          </span>
        ) : null}
      </button>
      <div className="flex justify-center py-0.5">
        <Icon name="ArrowDown" size={16} className="text-muted-foreground" />
      </div>
      {tile}
      {afterStep}
    </div>
  );
};

export default WorkTile;