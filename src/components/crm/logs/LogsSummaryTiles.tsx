import Icon from '@/components/ui/icon';
import type { LogSummary } from '@/lib/logsApi';

interface LogsSummaryTilesProps {
  summary: LogSummary | null;
}

/** Итоги за выбранный период — сколько чего сделали в цехе. */
const TILES: { key: keyof LogSummary; label: string; icon: string; className: string }[] = [
  { key: 'shiftsOpened', label: 'Смен открыто', icon: 'LogIn', className: 'text-emerald-600' },
  { key: 'shiftsClosed', label: 'Смен закрыто', icon: 'LogOut', className: 'text-muted-foreground' },
  { key: 'taken', label: 'Заказов взято', icon: 'HandHelping', className: 'text-sky-600' },
  { key: 'cut', label: 'Раскроено', icon: 'Scissors', className: 'text-amber-600' },
  { key: 'sewn', label: 'Сшито', icon: 'Shirt', className: 'text-violet-600' },
  { key: 'packed', label: 'Упаковано', icon: 'Package', className: 'text-blue-600' },
];

const LogsSummaryTiles = ({ summary }: LogsSummaryTilesProps) => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
    {TILES.map((t) => (
      <div key={t.key} className="rounded-lg border border-border p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon name={t.icon} size={13} className={t.className} />
          {t.label}
        </div>
        <p className="mt-1 text-2xl font-bold">{summary ? summary[t.key] : '—'}</p>
      </div>
    ))}
  </div>
);

export default LogsSummaryTiles;
