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
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
      {widgets.map((w) => (
        <Card
          key={w.label}
          onClick={() => navigate(w.path)}
          className={`group cursor-pointer border p-3 transition-all hover:shadow-md sm:flex sm:flex-col sm:gap-3 sm:p-4 ${toneCard[w.tone]}`}
        >
          {/* ТЕЛЕФОН — одна строка: значок, подпись, цифра.
              Полная карточка на телефоне занимала почти четверть экрана, и десяток
              показателей превращался в долгую прокрутку. В строке те же данные
              читаются сразу, а список целиком помещается на один-два экрана.
              Подсказку и кнопку «Открыть» здесь прячем: подпись и так говорит, о чём
              показатель, а нажимается вся строка. */}
          <div className="flex items-center gap-3 sm:hidden">
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${toneIcon[w.tone]}`}
            >
              <Icon name={w.icon} size={18} />
            </span>
            <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{w.label}</p>
            <span
              className={`shrink-0 text-2xl font-bold leading-none tracking-tight ${toneValue[w.tone]}`}
            >
              {loading ? '—' : w.value}
            </span>
            <Icon
              name="ChevronRight"
              size={16}
              className="shrink-0 text-muted-foreground"
            />
          </div>

          {/* ПЛАНШЕТ И КОМПЬЮТЕР — прежняя крупная карточка, без изменений. */}
          <div className="hidden sm:contents">
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
          </div>
        </Card>
      ))}
    </div>
  );
};

export default DashboardWidgetsGrid;
