import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import SewerOutputPanel from '@/components/crm/dashboard/SewerOutputPanel';
import StaffEfficiencyCard from '@/components/crm/dashboard/StaffEfficiencyCard';
import LototronCard from '@/components/crm/dashboard/LototronCard';

interface AdminPeoplePanelProps {
  actorId?: number;
}

type TabKey = 'output' | 'efficiency' | 'lototron';

const TABS: { key: TabKey; label: string; short: string; icon: string; hint: string }[] = [
  {
    key: 'output',
    label: 'Выработка',
    short: 'Выработка',
    icon: 'Trophy',
    hint: 'Акция дня и премия за месяц по швеям',
  },
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
 * «Люди» — один блок панели вместо трёх отдельных простыней.
 *
 * Раньше выработка, эффективность и лототрон стояли на главной тремя
 * сворачиваемыми секциями подряд. Все три — про одно и то же: как работают
 * люди и что им за это причитается. Открытые, они давали три экрана
 * прокрутки; свёрнутые — три одинаковых серых полоски, между которыми админ
 * всё равно щёлкал по очереди, чтобы сопоставить цифры.
 *
 * Теперь это один блок с вкладками: высота постоянная, переключение —
 * мгновенное, а выбранная вкладка запоминается до следующего захода.
 * Тяжёлые отчёты внутри монтируются только когда их открыли, поэтому панель
 * не тянет три запроса разом при загрузке главной.
 */
const AdminPeoplePanel = ({ actorId }: AdminPeoplePanelProps) => {
  const [tab, setTab] = useState<TabKey>(() => {
    try {
      const saved = localStorage.getItem(KEY) as TabKey | null;
      return saved && TABS.some((t) => t.key === saved) ? saved : 'output';
    } catch {
      return 'output';
    }
  });
  // Какие вкладки человек уже открывал: закрытая вкладка не должна ходить в
  // сеть, но и перезагружаться при каждом возврате — тоже.
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

        {/* Вкладки: на телефоне — короткие подписи, чтобы три штуки влезли
            в строку и не превращались в скролл. */}
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
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

        {/* Каждая вкладка остаётся смонтированной после первого открытия:
            возврат к ней не должен заново дёргать сервер и терять фильтры. */}
        {visited.has('output') && (
          <div className={tab === 'output' ? '' : 'hidden'}>
            <SewerOutputPanel />
          </div>
        )}
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
