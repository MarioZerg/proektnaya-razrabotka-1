import type { Row } from './fbsChecklistShared';

const shortName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
};

/**
 * Кто делал вещь: от раскроя до добавления в поставку.
 *
 * Ищут пропажу и брак по людям — поэтому показываем всю цепочку, а не только
 * того, кто наклеил ярлык (у вещи из цеха его там нет: ярлык клеит упаковщица).
 */
const ConveyorCell = ({ row }: { row: Row }) => {
  const steps: [string, string | null | undefined][] = [
    ['Крой', row.cutterName],
    ['Пошив', row.sewerName],
    ['Оверлок', row.overlockName],
    ['Упаковка', row.packerName],
    ['Стикер', row.labeledByName],
    ['В поставку', row.addedByName],
  ];
  const filled = steps.filter(([, name]) => !!name) as [string, string][];
  if (filled.length === 0) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5 text-xs leading-tight">
      {filled.map(([label, name]) => (
        <div key={label} title={name}>
          <span className="text-muted-foreground">{label}:</span> {shortName(name)}
        </div>
      ))}
    </div>
  );
};

export default ConveyorCell;
