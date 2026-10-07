import Icon from '@/components/ui/icon';
import { formatDateTime } from '@/lib/dateUtils';
import {
  formatLifeDay,
  lifeKindStyle,
  type LifeEvent,
} from '@/lib/goodsLifeTimeline';

interface GoodsLifeTimelineProps {
  events: LifeEvent[];
  /** В строке склада — горизонтально, без ФИО. На карточке — вертикально. */
  compact?: boolean;
}

/**
 * Жизнь вещи одной лентой: в подбор → в поставку → отгрузили → выкуплен.
 *
 * Компактный вид живёт прямо в строке списка, полный — на карточке, с датой
 * и тем, кто это сделал.
 */
const GoodsLifeTimeline = ({ events, compact = false }: GoodsLifeTimelineProps) => {
  if (events.length === 0) {
    if (compact) return <span className="text-xs text-muted-foreground">—</span>;
    return (
      <p className="text-sm text-muted-foreground">
        История пока пустая — по этой вещи ещё не было событий
      </p>
    );
  }

  if (compact) {
    return (
      <ol className="flex flex-wrap items-end gap-y-1">
        {events.map((e, i) => {
          const last = i === events.length - 1;
          const style = lifeKindStyle[e.kind];
          return (
            <li key={`${e.kind}-${e.at}-${i}`} className="flex items-end">
              {i > 0 && (
                <span
                  className="mb-[13px] h-px w-2.5 shrink-0 sm:w-3.5"
                  style={{ background: style.hex }}
                  aria-hidden
                />
              )}
              <div className="flex min-w-[3.25rem] max-w-[6.5rem] flex-col items-center text-center">
                <span
                  className={`rounded-full ${last ? 'h-2.5 w-2.5' : 'h-2 w-2'}`}
                  style={{ background: style.hex }}
                />
                <span
                  className="mt-0.5 text-[10px] font-semibold leading-tight"
                  style={{ color: style.hex }}
                >
                  {e.label}
                </span>
                <span className="text-[10px] tabular-nums leading-tight text-muted-foreground">
                  {formatLifeDay(e.day || e.at)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    );
  }

  return (
    <ol>
      {events.map((e, i) => {
        const last = i === events.length - 1;
        const style = lifeKindStyle[e.kind];
        return (
          <li key={`${e.kind}-${e.at}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && (
              <span
                className="absolute left-[11px] top-6 h-[calc(100%-18px)] w-0.5 rounded-full"
                style={{ background: style.hex }}
              />
            )}
            <span
              className="relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
              style={{ background: style.hex }}
            >
              <Icon name={style.icon} size={12} />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              {/* Подпись и дата в одну строку: дату не обрезаем и не переносим */}
              <div className="flex items-baseline gap-x-2">
                <span className="min-w-0 text-sm font-semibold">{e.label}</span>
                <span className="shrink-0 whitespace-nowrap tabular-nums text-xs text-muted-foreground">
                  {formatDateTime(e.at)}
                </span>
              </div>
              {(e.who || e.detail) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {[e.who, e.detail].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
};

export default GoodsLifeTimeline;