import Icon from '@/components/ui/icon';
import type { LogSummary } from '@/lib/logsApi';

interface LogsSummaryTilesProps {
  summary: LogSummary | null;
}

/** Итоги за выбранный период — сколько чего сделали в цехе. */
const TILES: {
  metric: keyof LogSummary;
  label: string;
  short: string;
  icon: string;
  className: string;
}[] = [
  { metric: 'shiftsOpened', label: 'Смен открыто', short: 'Открыто', icon: 'LogIn', className: 'text-emerald-600' },
  { metric: 'shiftsClosed', label: 'Смен закрыто', short: 'Закрыто', icon: 'LogOut', className: 'text-muted-foreground' },
  { metric: 'taken', label: 'Заказов взято', short: 'Взято', icon: 'HandHelping', className: 'text-sky-600' },
  { metric: 'cut', label: 'Раскроено', short: 'Раскрой', icon: 'Scissors', className: 'text-amber-600' },
  { metric: 'sewn', label: 'Сшито', short: 'Пошив', icon: 'Shirt', className: 'text-violet-600' },
  { metric: 'packed', label: 'Упаковано', short: 'Упаковка', icon: 'Package', className: 'text-blue-600' },
];

const tileCount = (summary: LogSummary | null, metric: keyof LogSummary) => {
  if (!summary) return '—';
  const n = summary[metric];
  return n == null ? '—' : n;
};

const LogsSummaryTiles = ({ summary }: LogsSummaryTilesProps) => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
    {TILES.map((t) => (
      <div key={t.metric} className="rounded-lg border border-border p-2.5 sm:p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name={t.icon} size={13} className={`shrink-0 ${t.className}`} />
          <span className="sm:hidden">{t.short}</span>
          <span className="hidden sm:inline">{t.label}</span>
        </div>
        <p className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">
          {tileCount(summary, t.metric)}
        </p>
      </div>
    ))}
  </div>
);

export default LogsSummaryTiles;
