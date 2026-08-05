import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { toneStyles, type DashboardWidgetData } from '@/components/crm/dashboard/dashboardShared';

interface DashboardWidgetsGridProps {
  widgets: DashboardWidgetData[];
  loading: boolean;
}

const DashboardWidgetsGrid = ({ widgets, loading }: DashboardWidgetsGridProps) => {
  const navigate = useNavigate();

  // На мобильных — плоские строки во всю ширину (компактно), с sm — привычные плитки.
  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border sm:grid sm:grid-cols-3 sm:gap-3 sm:divide-y-0 sm:rounded-none sm:border-0 lg:grid-cols-5">
      {widgets.map((w) => (
        <Card
          key={w.label}
          className="cursor-pointer rounded-none border-0 shadow-none transition-colors hover:bg-muted/50 sm:rounded-lg sm:border sm:border-border"
          onClick={() => navigate(w.path)}
        >
          <CardContent className="flex items-center gap-3 p-3 sm:flex-col sm:items-stretch sm:gap-2 sm:p-4">
            <span
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted ${toneStyles[w.tone]}`}
            >
              <Icon name={w.icon} size={16} />
            </span>
            <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground sm:order-last sm:whitespace-normal sm:text-xs sm:leading-snug">
              {w.label}
            </p>
            <p className="text-xl font-bold leading-none sm:text-2xl">{loading ? '—' : w.value}</p>
            {w.tone !== 'default' && (
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full sm:hidden ${
                  w.tone === 'urgent' ? 'bg-destructive' : 'bg-amber-500'
                }`}
              />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default DashboardWidgetsGrid;