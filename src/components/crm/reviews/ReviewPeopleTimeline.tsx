import { shortName } from '@/components/crm/users/usersShared';

/** Кто делал заказ: кроткая лента на каждом отзыве (терминал и таблица). */
const ReviewPeopleTimeline = ({
  cutterName,
  sewerName,
  packerName,
  compact = false,
}: {
  cutterName?: string | null;
  sewerName?: string | null;
  packerName?: string | null;
  compact?: boolean;
}) => {
  const steps = [
    { key: 'cut', label: 'Кроил', name: cutterName },
    { key: 'sew', label: 'Шил', name: sewerName },
    { key: 'pack', label: 'Упаковал', name: packerName },
  ];

  return (
    <ol
      className={`mt-2 grid gap-1.5 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3'}`}
    >
      {steps.map((s, i) => (
        <li
          key={s.key}
          className={`flex min-w-0 items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-2 py-1.5 ${
            compact ? 'text-sm' : 'text-xs sm:text-sm'
          }`}
        >
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-background text-[10px] font-bold text-muted-foreground">
            {i + 1}
          </span>
          <span className="min-w-0">
            <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
              {s.label}
            </span>
            <span className={`block truncate font-medium ${s.name ? '' : 'text-muted-foreground'}`}>
              {s.name ? shortName(s.name) : '—'}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
};

export default ReviewPeopleTimeline;
