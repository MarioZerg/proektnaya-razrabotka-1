import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { formatQuantity } from '@/lib/formatQuantity';
import { fetchRolls, type Roll } from '@/lib/rollsApi';
import type { WorkshopMaterialColumn, WorkshopMaterialRow } from '@/lib/workshopMaterialsApi';

interface WorkshopMaterialRollsProps {
  material: WorkshopMaterialRow;
  /** Тип материала: «Тюль», «Аксессуары», «Упаковка». */
  typeName: string;
  columns: WorkshopMaterialColumn[];
  showWorkshopName: boolean;
}

/** Кроят только ткань тюль и тесьму. Этикетки и прочие аксессуары используют. */
const isCutMaterial = (typeName: string, materialName: string) =>
  typeName === 'Тюль' || /тесьм/i.test(materialName);

const untouched = (roll: Roll) => {
  const used = roll.usedQuantity ?? 0;
  return used <= 0.001 && roll.remainingQuantity + 0.001 >= roll.initialQuantity;
};

/** С какого момента рулон без дела: последний расход, иначе приёмка сменой, иначе отгрузка. */
const idleSince = (roll: Roll) => roll.lastUsedAt || roll.acceptedAt || roll.createdAt;

const idleMs = (roll: Roll, now: number) => {
  const since = idleSince(roll);
  return since ? Math.max(0, now - new Date(since).getTime()) : 0;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const formatIdle = (ms: number) => {
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / 60_000))} мин`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    const m = Math.floor((ms % HOUR) / 60_000);
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  }
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  return h ? `${d} дн ${h} ч` : `${d} дн`;
};

/** До суток — норма, до трёх — стоит присмотреться, дольше — рулон застрял. */
const idleClass = (ms: number) =>
  ms >= 3 * DAY
    ? 'bg-red-100 text-red-800'
    : ms >= DAY
      ? 'bg-amber-100 text-amber-800'
      : 'bg-emerald-50 text-emerald-800';

const RollLine = ({ roll, unit, now }: { roll: Roll; unit: string; now: number }) => {
  const ms = idleMs(roll, now);
  return (
    <li className="border-b border-border/70 px-2 py-1.5 last:border-0">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-mono-tech text-xs font-semibold">{roll.barcode}</span>
        <span className="shrink-0 text-right text-xs tabular-nums">
          {formatQuantity(roll.remainingQuantity)}
          {!untouched(roll) && (
            <span className="text-muted-foreground"> / {formatQuantity(roll.initialQuantity)}</span>
          )}{' '}
          {unit}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {roll.pendingAcceptance ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
            в пути
          </span>
        ) : (
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${idleClass(ms)}`}
            title={roll.lastUsedAt ? 'С последнего расхода' : 'С приёмки в цех, расходов ещё не было'}
          >
            <Icon name="Timer" size={11} />
            {roll.lastUsedAt ? 'простой' : 'не трогали'} {formatIdle(ms)}
          </span>
        )}
      </div>
    </li>
  );
};

const Column = ({
  title,
  rolls,
  unit,
  empty,
  now,
}: {
  title: string;
  rolls: Roll[];
  unit: string;
  empty: string;
  now: number;
}) => (
  <div className="min-w-0 overflow-hidden rounded-md border border-border bg-card">
    <div className="border-b border-border bg-muted/60 px-2 py-1.5 text-[11px] font-semibold">
      {title}
      <span className="ml-1 font-normal text-muted-foreground">{rolls.length}</span>
    </div>
    {rolls.length === 0 ? (
      <p className="px-2 py-2 text-xs text-muted-foreground">{empty}</p>
    ) : (
      <ul>
        {rolls.map((roll) => (
          <RollLine key={roll.id} roll={roll} unit={unit} now={now} />
        ))}
      </ul>
    )}
  </div>
);

/**
 * Рулоны одного материала в цехе: у каждой смены своя таблица.
 * Тюль и тесьму кроят, этикетки и остальные аксессуары используют.
 */
const WorkshopMaterialRolls = ({
  material,
  typeName,
  columns,
  showWorkshopName,
}: WorkshopMaterialRollsProps) => {
  const cut = isCutMaterial(typeName, material.materialName);
  const usedTitle = cut ? 'Уже кроили' : 'Уже использовали';
  const [rolls, setRolls] = useState<Roll[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Таймер простоя тикает раз в минуту — секунды тут ни к чему, а сервер не дёргаем.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchRolls({ materialId: material.materialId, status: 'in_workshop' })
      .then((list) => {
        if (!cancelled) setRolls(list);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Не удалось загрузить рулоны');
      });
    return () => {
      cancelled = true;
    };
  }, [material.materialId]);

  if (error) {
    return <p className="mt-2 text-xs text-destructive">{error}</p>;
  }
  if (!rolls) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon name="Loader2" size={14} className="animate-spin" />
        Рулоны…
      </p>
    );
  }

  // Упаковка — общий пул: все коробки цеха в одной таблице, без разбивки по сменам.
  const sharedPool = typeName === 'Упаковка';

  const tables = columns
    .map((col) => {
      const mine = rolls.filter((roll) => {
        if (roll.workshopId !== col.workshopId) return false;
        if (sharedPool || col.shiftNumber == null) return true;
        return roll.shiftNumber === col.shiftNumber;
      });
      // Сверху — дольше всех без дела: застрявший рулон видно сразу.
      const byIdle = (a: Roll, b: Roll) => idleMs(b, now) - idleMs(a, now);
      const fresh = mine.filter(untouched).sort(byIdle);
      const cut = mine.filter((roll) => !untouched(roll)).sort(byIdle);
      return { col, fresh, cut };
    })
    .filter((table) => table.fresh.length + table.cut.length > 0);

  if (tables.length === 0) {
    return <p className="mt-2 text-xs text-muted-foreground">В цехе нет открытых рулонов</p>;
  }

  return (
    <div className="mt-2 space-y-3">
      {tables.map(({ col, fresh, cut }) => (
        <div key={`${col.workshopId}-${col.shiftNumber}`}>
          <p className="mb-1 text-xs font-semibold">
            {showWorkshopName ? `${col.workshopName} · ` : ''}
            {col.shiftLabel}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Column title="Новые, не тронутые" rolls={fresh} unit={material.unit} empty="Нет" now={now} />
            <Column title={usedTitle} rolls={cut} unit={material.unit} empty="Нет" now={now} />
          </div>
        </div>
      ))}
    </div>
  );
};

export default WorkshopMaterialRolls;
