import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import {
  STAGE_ORDER,
  productionOrder,
  type DashboardWidgetData,
} from '@/components/crm/dashboard/dashboardShared';

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
        <div key={group.key} className="space-y-2.5">
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

          <div className="grid grid-cols-2 gap-2 md:grid-cols-2 md:gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {group.items.map((w) => {
            const motion = tileMotion(w, loading);
            return (
              <Card
                key={w.label}
                onClick={() => navigate(w.path)}
                className={`group relative min-w-0 cursor-pointer overflow-hidden border p-2.5 transition-all hover:shadow-md md:flex md:flex-col md:gap-3 md:p-4 ${
                  motion === 'alert' ? 'animate-tile-alert' : toneCard[w.tone]
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
                <div className="relative md:hidden">
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${toneIcon[w.tone]}`}
                    >
                      <Icon name={w.icon} size={16} />
                    </span>
                    <span
                      className={`min-w-0 text-right text-xl font-bold leading-none tabular-nums tracking-tight ${toneValue[w.tone]}`}
                    >
                      {loading ? '—' : w.value}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 break-words text-xs font-semibold leading-tight">
                    {w.shortLabel || w.label}
                  </p>
                </div>

                {/* ПЛАНШЕТ И КОМПЬЮТЕР — прежняя крупная карточка. */}
                <div className="hidden md:contents">
                  {/* Верхняя строка: крупный значок слева, цифра справа — самое
                      важное читается одним взглядом, не вчитываясь в подписи. */}
                  <div className="relative flex items-start justify-between gap-3">
                    <span
                      className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${toneIcon[w.tone]}`}
                    >
                      <Icon name={w.icon} size={22} />
                    </span>
                    <span
                      className={`text-3xl font-bold leading-none tracking-tight ${toneValue[w.tone]}`}
                    >
                      {loading ? '—' : w.value}
                    </span>
                  </div>

                  <div className="relative min-w-0 space-y-1">
                    <p className="line-clamp-2 text-sm font-semibold leading-snug">{w.label}</p>
                    {w.hint && (
                      <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                        {w.hint}
                      </p>
                    )}
                  </div>

                  {/* Кнопка-подсказка внизу, как в привычных панелях: видно, что
                      карточка кликабельна и куда она ведёт. */}
                  <span className="relative mt-auto flex items-center gap-1 pt-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-primary">
                    Открыть
                    <Icon
                      name="ArrowRight"
                      size={13}
                      className="transition-transform group-hover:translate-x-0.5"
                    />
                  </span>
                </div>
              </Card>
            );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

export default DashboardWidgetsGrid;