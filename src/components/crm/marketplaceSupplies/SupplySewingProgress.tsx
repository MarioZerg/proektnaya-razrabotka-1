interface SupplySewingProgressProps {
  total: number;
  done: number;
}

/** Прогресс пошива по поставке для списка: «сшито из всего» и полоска заполнения.
 * Зелёная — всё готово, синяя — ещё шьётся. */
const SupplySewingProgress = ({ total, done }: SupplySewingProgressProps) => {
  if (!total) return <span className="text-muted-foreground">—</span>;

  const percent = Math.round((done / total) * 100);
  const isDone = done >= total;

  return (
    <div className="min-w-[110px] space-y-1">
      <div className="text-sm">
        <b className={isDone ? 'text-emerald-700' : ''}>{done}</b>
        <span className="text-muted-foreground"> из {total}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${isDone ? 'bg-emerald-600' : 'bg-sky-500'}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};

export default SupplySewingProgress;
