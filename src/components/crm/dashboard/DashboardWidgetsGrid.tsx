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

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {widgets.map((w) => (
        <Card
          key={w.label}
          className="cursor-pointer border-border shadow-none transition-colors hover:bg-muted/50"
          onClick={() => navigate(w.path)}
        >
          <CardContent className="flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between">
              <span
                className={`grid h-8 w-8 place-items-center rounded-md bg-muted ${toneStyles[w.tone]}`}
              >
                <Icon name={w.icon} size={16} />
              </span>
              {w.tone !== 'default' && (
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    w.tone === 'urgent' ? 'bg-destructive' : 'bg-amber-500'
                  }`}
                />
              )}
            </div>
            <p className="text-2xl font-bold leading-none">{loading ? '—' : w.value}</p>
            <p className="text-xs leading-snug text-muted-foreground">{w.label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default DashboardWidgetsGrid;
