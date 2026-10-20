import { Link, useLocation } from 'react-router-dom';
import Icon from '@/components/ui/icon';

const tabs = [
  { path: '/crm/settings/logs', label: 'Действия', icon: 'ScrollText' },
  { path: '/crm/settings/logs/errors', label: 'Сбои у сотрудников', icon: 'Bug' },
];

/** Переключатель внутри журнала: действия сотрудников и сбои программы. */
const LogsTabs = () => {
  const { pathname } = useLocation();
  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-1">
      {tabs.map((t) => {
        const active = pathname === t.path;
        return (
          <Link
            key={t.path}
            to={t.path}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon name={t.icon} size={15} />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
};

export default LogsTabs;
