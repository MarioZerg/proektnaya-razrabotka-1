import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import ProductionCapacityDialog from '@/components/crm/dashboard/ProductionCapacityDialog';
import ProductionFlowCard from '@/components/crm/dashboard/ProductionFlowCard';
import { WidgetRunRing } from '@/components/crm/dashboard/ShiftAvatarRail';
import {
  STAGE_ORDER,
  productionOrder,
  type DashboardWidgetData,
} from '@/components/crm/dashboard/dashboardShared';

const WidgetMatrix = ({
  matrix,
}: {
  matrix: NonNullable<DashboardWidgetData['matrix']>;
}) => (
  <div className="min-w-0 overflow-x-auto rounded-md border border-border/70 text-[11px] leading-tight">
    <div className="grid min-w-[17rem] grid-cols-[2.5rem_repeat(3,minmax(4.4rem,1fr))]">
      <div className="bg-muted/60" />
      {matrix.columns.map((column) => (
        <div key={column} className="whitespace-nowrap bg-muted/60 px-1 py-1 text-center text-muted-foreground">
          {column}
        </div>
      ))}
      {matrix.rows.flatMap((row) => [
        <div
          key={`${row.label}-name`}
          className={`border-t border-border/70 px-1.5 py-1 ${row.label === 'всего' ? 'font-semibold' : ''}`}
        >
          {row.label}
        </div>,
        ...row.values.map((value, index) => (
          <div
            key={`${row.label}-${matrix.columns[index]}`}
            className={`border-t border-border/70 px-1 py-1 text-center tabular-nums ${
              row.label === 'всего' ? 'font-semibold' : ''
            }`}
          >
            {value}
          </div>
        )),
      ])}
    </div>
  </div>
);

interface DashboardWidgetsGridProps {
  widgets: DashboardWidgetData[];
  loading: boolean;
}

/** Оформление карточки по важности: срочное — красное, ожидающее — янтарное. */
const toneCard: Record<DashboardWidgetData['tone'], string> = {
  default: 'border-border hover:border-primary/40',
  warning: 'border-amber-200 bg-amber-50/40 hover:border-amber-300',
  urgent: 'border-destructive/30 bg-destructive/[0.04] hover:border-destructive/50',
};

/** Кружок под значком — тем же цветом, что и рамка карточки. */
const toneIcon: Record<DashboardWidgetData['tone'], string> = {
  default: 'bg-primary/10 text-primary',
  warning: 'bg-amber-100 text-amber-700',
  urgent: 'bg-destructive/10 text-destructive',
};

const toneValue: Record<DashboardWidgetData['tone'], string> = {
  default: 'text-foreground',
  warning: 'text-amber-700',
  urgent: 'text-destructive',
};

/**
 * Как плитка должна себя вести: спокойно, переливаться или пульсировать.
 *
 * Плитки склада — это очередь работы. Пока в ней пусто, плитка обычная. Появилась
 * работа — плитка переливается: видно, что есть чем заняться, но ничего не горит.
 * Очередь переросла порог (у каждой плитки свой) — пульсирует красным: разбирать
 * нужно сейчас, иначе цех встанет или отгрузка опоздает.
 *
 * Пока данные грузятся, не мигаем ничем: цифры ещё нет, и вспышка на пустом месте
 * только сбивает с толку.
 */
const tileMotion = (w: DashboardWidgetData, loading: boolean) => {
  if (loading || !w.pulseFrom || w.value <= 0) return 'none' as const;
  return w.value >= w.pulseFrom ? ('alert' as const) : ('sheen' as const);
};

const DashboardWidgetsGrid = ({ widgets, loading }: DashboardWidgetsGridProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [capacityOpen, setCapacityOpen] = useState(false);
  const canPlan = user?.role === 'admin' || user?.role === 'manager';
  const spotlight = widgets.find((widget) => widget.spotlight);
  const conveyorCount = (label: string) =>
    spotlight?.matrix?.rows.find((row) => row.label === label)?.values[0] ?? 0;

  // Два блока: производство и склад. Пустые не показываем — у швеи нет складских
  // показателей, и заголовок без единой плитки был бы просто шумом.
  const groups = STAGE_ORDER.map((stage) => {
    const items = widgets.filter((w) => w.stage === stage.key);
    // Внутри производства выстраиваем плитки по ходу работы: новые задания →
    // в закрое → раскроено → в пошиве → на стикеровке.
    if (stage.key === 'production') {
      items.sort((a, b) => productionOrder(a.label) - productionOrder(b.label));
    }
    return { ...stage, items };
  }).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div
          key={group.key}
          id={
            group.key === 'production'
              ? 'dashboard-stage-production'
              : group.key === 'warehouse'
                ? 'dashboard-stage-warehouse'
                : undefined
          }
          className="space-y-2.5"
        >
          {/* Заголовок этапа: видно, на каком участке пути находится показатель.
              Раньше плитки шли сплошной лентой, и «Не принятые поставки» стояли
              между пошивом и стикеровкой — нужную приходилось искать глазами. */}
          <div className="flex items-center gap-2">
            <Icon
              name={group.icon}
              size={15}
              className={
                group.key === 'attention' ? 'text-destructive' : 'text-muted-foreground'
              }
            />
            <h2
              className={`text-xs font-semibold uppercase tracking-wide ${
                group.key === 'attention' ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {group.title}
            </h2>
            <span className="h-px flex-1 bg-border" />
          </div>

          <div
            className={
              group.key === 'production'
                ? 'grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3'
                : 'grid grid-cols-2 gap-2 md:grid-cols-2 md:gap-3 lg:grid-cols-3 2xl:grid-cols-4'
            }
          >
            {group.items.map((w) => {
            if (group.key === 'production') {
              return (
                <ProductionFlowCard
                  key={w.label}
                  widget={w}
                  loading={loading}
                  onOpen={() => navigate(w.path)}
                  onCapacity={w.spotlight && canPlan ? () => setCapacityOpen(true) : undefined}
                />
              );
            }
            const motion = tileMotion(w, loading);
            return (
              <div
                key={w.label}
                className={`relative min-w-0 ${w.spotlight ? 'col-span-full rounded-xl p-[2px]' : 'h-full'}`}
              >
                {w.spotlight && <WidgetRunRing />}
              <Card
                onClick={w.spotlight ? undefined : () => navigate(w.path)}
                className={`group relative min-w-0 overflow-hidden border p-2.5 transition-all hover:shadow-md md:p-4 ${
                  w.spotlight ? 'cursor-default rounded-xl' : 'h-full cursor-pointer md:flex md:flex-col md:gap-3'
                } ${
                  w.spotlight
                    ? 'border-transparent bg-card'
                    : motion === 'alert'
                      ? 'animate-tile-alert'
                      : toneCard[w.tone]
                }`}
              >
                {/* Блик перелива: узкая светлая полоса, медленно проходящая по
                    карточке. Лежит поверх фона, но под содержимым и не ловит
                    клики — плитка нажимается как обычно.
                    Ставим блик от ЛЕВОГО КРАЯ (left-0), а за край его уводит сама
                    анимация. Раньше блок дополнительно сдвигался классом -left-1/3,
                    и этот сдвиг складывался со сдвигом анимации: полоса начинала
                    путь уже внутри плитки и уходила, не дойдя до правого края. */}
                {motion === 'sheen' && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-tile-sheen bg-gradient-to-r from-transparent via-white/70 to-transparent"
                  />
                )}
                {/* ТЕЛЕФОН — мини-плитка в две колонки. Полная ширина с длинной
                    подсказкой растягивала текст на весь экран и превращала
                    десяток показателей в простыню. Здесь значок и цифра сверху,
                    название в две строки — карточки читаются сеткой. */}
                {!w.spotlight && (
                <div className="relative md:hidden">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${toneIcon[w.tone]}`}
                      >
                        <Icon name={w.icon} size={16} />
                      </span>
                      {w.spotlight && (
                        <p className="mt-1 max-w-[7.5rem] text-[11px] font-semibold leading-tight">
                          {w.shortLabel || w.label}
                        </p>
                      )}
                    </div>
                    <span
                      className={`min-w-0 text-right text-xl font-bold leading-none tabular-nums tracking-tight ${toneValue[w.tone]}`}
                    >
                      {loading ? '—' : w.value}
                    </span>
                  </div>
                  {w.matrix && !loading && <WidgetMatrix matrix={w.matrix} />}
                  {w.parts && !w.matrix && !loading && (
                    <div className="mt-1.5 grid grid-cols-3 gap-1 text-center">
                      {w.parts.map((part) => (
                        <div key={part.label} className="min-w-0">
                          <div className="text-sm font-bold tabular-nums leading-none">{part.value}</div>
                          <div className="mt-0.5 break-words text-[10px] leading-tight text-muted-foreground">{part.label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!w.spotlight && (
                    <p className="mt-1.5 break-words text-xs font-semibold leading-tight">
                      {w.shortLabel || w.label}
                    </p>
                  )}
                </div>
                )}

                {/* ПЛАНШЕТ И КОМПЬЮТЕР — прежняя крупная карточка. */}
                {!w.spotlight && (
                <div className="hidden md:contents">
                  {/* Верхняя строка: крупный значок слева, цифра справа — самое
                      важное читается одним взглядом, не вчитываясь в подписи. */}
                  <div className="relative flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <span
                        className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${toneIcon[w.tone]}`}
                      >
                        <Icon name={w.icon} size={22} />
                      </span>
                      {w.spotlight && (
                        <p className="mt-1.5 max-w-[9rem] text-xs font-semibold leading-tight">
                          {w.shortLabel || w.label}
                        </p>
                      )}
                    </div>
                    <span
                      className={`text-3xl font-bold leading-none tracking-tight ${toneValue[w.tone]}`}
                    >
                      {loading ? '—' : w.value}
                    </span>
                  </div>
                  {w.matrix && !loading && <WidgetMatrix matrix={w.matrix} />}
                  {w.parts && !w.matrix && !loading && (
                    <div className="relative mt-3 grid grid-cols-3 gap-2 border-t border-border/70 pt-2 text-center">
                      {w.parts.map((part) => (
                        <div key={part.label} className="min-w-0">
                          <div className="text-lg font-bold tabular-nums leading-none">{part.value}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">{part.label}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {!w.spotlight && (
                  <div className="relative min-w-0 space-y-1">
                    <p className="break-words text-sm font-semibold leading-snug">{w.label}</p>
                    {w.hint && (
                      <p className="break-words text-xs leading-snug text-muted-foreground">
                        {w.hint}
                      </p>
                    )}
                  </div>
                  )}

                  {/* Кнопка-подсказка внизу, как в привычных панелях: видно, что
                      карточка кликабельна и куда она ведёт. */}
                  {!w.spotlight && (
                  <span className="relative mt-auto flex items-center gap-1 pt-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-primary">
                    Открыть
                    <Icon
                      name="ArrowRight"
                      size={13}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                  )}
                </div>
                )}
                {w.spotlight && (
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex min-w-0 items-center justify-between gap-3 sm:w-44 sm:shrink-0 sm:flex-col sm:items-start sm:justify-center">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg sm:h-11 sm:w-11 sm:rounded-xl ${toneIcon[w.tone]}`}>
                          <Icon name={w.icon} size={18} />
                        </span>
                        <p className="text-sm font-semibold leading-tight">{w.shortLabel || w.label}</p>
                      </div>
                      <p className={`text-2xl font-bold leading-none tabular-nums sm:text-3xl ${toneValue[w.tone]}`}>
                        {loading ? '—' : w.value}
                      </p>
                    </div>
                    <div className="min-w-0 flex-1">
                      {w.matrix && !loading && <WidgetMatrix matrix={w.matrix} />}
                    </div>
                    <div className="grid min-w-0 grid-cols-2 gap-1.5 sm:w-32 sm:shrink-0 sm:grid-cols-1">
                      <button
                        type="button"
                        onClick={() => navigate(w.path)}
                        className="inline-flex min-w-0 items-center justify-center gap-1 rounded-md bg-primary px-2 py-2 text-xs font-medium text-primary-foreground"
                      >
                        Открыть
                        <Icon name="ArrowRight" size={13} />
                      </button>
                      {canPlan && (
                        <button
                          type="button"
                          onClick={() => setCapacityOpen(true)}
                          className="inline-flex min-w-0 items-center justify-center rounded-md border bg-background px-2 py-2 text-xs font-medium"
                        >
                          Мощность
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </Card>
              </div>
            );
            })}
          </div>
        </div>
      ))}
      <ProductionCapacityDialog
        open={capacityOpen}
        onOpenChange={setCapacityOpen}
        fbsQueue={conveyorCount('FBS')}
        fboQueue={conveyorCount('FBO')}
      />
    </div>
  );
};

export default DashboardWidgetsGrid;