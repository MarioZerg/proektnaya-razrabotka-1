import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { type DashboardWidgetData } from '@/components/crm/dashboard/dashboardShared';

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

const DashboardWidgetsGrid = ({ widgets, loading }: DashboardWidgetsGridProps) => {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {widgets.map((w) => (
        <Card
          key={w.label}
          onClick={() => navigate(w.path)}
          className={`group flex cursor-pointer flex-col gap-3 border p-4 transition-all hover:shadow-md ${toneCard[w.tone]}`}
        >
          {/* Верхняя строка: крупный значок слева, цифра справа — самое важное
              читается одним взглядом, не вчитываясь в подписи. */}
          <div className="flex items-start justify-between gap-3">
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

          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold leading-snug">{w.label}</p>
            {w.hint && (
              <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                {w.hint}
              </p>
            )}
          </div>

          {/* Кнопка-подсказка внизу, как в привычных панелях: видно, что карточка
              кликабельна и куда она ведёт. */}
          <span className="mt-auto flex items-center gap-1 pt-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-primary">
            Открыть
            <Icon
              name="ArrowRight"
              size={13}
              className="transition-transform group-hover:translate-x-0.5"
            />
          </span>
        </Card>
      ))}
    </div>
  );
};

export default DashboardWidgetsGrid;
