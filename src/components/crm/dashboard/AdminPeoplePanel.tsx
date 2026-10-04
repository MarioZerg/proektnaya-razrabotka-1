import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import StaffEfficiencyCard from '@/components/crm/dashboard/StaffEfficiencyCard';
import LototronCard from '@/components/crm/dashboard/LototronCard';

interface AdminPeoplePanelProps {
  actorId?: number;
}

type TabKey = 'efficiency' | 'lototron';

const TABS: { key: TabKey; label: string; short: string; icon: string; hint: string }[] = [
  {
    key: 'efficiency',
    label: 'Эффективность',
    short: 'Темп',
    icon: 'TrendingUp',
    hint: 'Темп и возвраты по швеям, закройщикам и упаковщикам',
  },
  {
    key: 'lototron',
    label: 'Лототрон',
    short: 'Варики',
    icon: 'Coins',
    hint: 'Розыгрыш, списание и начисление вариков',
  },
];

const KEY = 'dash-people-tab';

/**
 * «Люди» — один блок панели вместо отдельных простыней.
 *
 * Вкладку «Выработка» (акция дня и премия за метраж) убрали: программа
 * закончилась 30.09.2026. Остались эффективность и лототрон.
 */
const AdminPeoplePanel = ({ actorId }: AdminPeoplePanelProps) => {
  const [tab, setTab] = useState<TabKey>(() => {
    try {
      const saved = localStorage.getItem(KEY);
      // Старое значение «output» после снятия вкладки больше не валидно.
      if (saved === 'efficiency' || saved === 'lototron') return saved;
    } catch {
      /* память недоступна */
    }
    return 'efficiency';
  });
  const [visited, setVisited] = useState<Set<TabKey>>(() => new Set<TabKey>([tab]));

  useEffect(() => {
    try {
      localStorage.setItem(KEY, tab);
    } catch {
      /* память недоступна — выбор живёт до перезагрузки страницы */
    }
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
  }, [tab]);

  const active = TABS.find((t) => t.key === tab)!;

  return (
    <Card className="border-border shadow-none">
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="Users" size={16} className="text-muted-foreground" />
            Люди и результат
          </p>
          <p className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
            {active.hint}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                tab === t.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon name={t.icon} size={14} className="shrink-0" />
              <span className="hidden sm:inline">{t.label}</span>
              <span className="sm:hidden">{t.short}</span>
            </button>
          ))}
        </div>

        {visited.has('efficiency') && (
          <div className={tab === 'efficiency' ? '' : 'hidden'}>
            <StaffEfficiencyCard />
          </div>
        )}
        {visited.has('lototron') && (
          <div className={tab === 'lototron' ? '' : 'hidden'}>
            <LototronCard actorId={actorId} />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AdminPeoplePanel;
