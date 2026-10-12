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

const RollLine = ({ roll, unit }: { roll: Roll; unit: string }) => (
  <li className="flex min-w-0 items-baseline justify-between gap-2 border-b border-border/70 px-2 py-1.5 last:border-0">
    <span className="min-w-0 truncate font-mono-tech text-xs font-semibold">{roll.barcode}</span>
    <span className="shrink-0 text-right text-xs tabular-nums">
      {formatQuantity(roll.remainingQuantity)}
      {!untouched(roll) && (
        <span className="text-muted-foreground"> / {formatQuantity(roll.initialQuantity)}</span>
      )}{' '}
      {unit}
      {roll.pendingAcceptance && (
        <span className="mt-0.5 block text-[10px] font-medium text-amber-700">в пути</span>
      )}
    </span>
  </li>
);

const Column = ({
  title,
  rolls,
  unit,
  empty,
}: {
  title: string;
  rolls: Roll[];
  unit: string;
  empty: string;
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
          <RollLine key={roll.id} roll={roll} unit={unit} />
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

  const tables = columns
    .map((col) => {
      const mine = rolls.filter(
        (roll) => roll.workshopId === col.workshopId && roll.shiftNumber === col.shiftNumber,
      );
      const fresh = mine
        .filter(untouched)
        .sort((a, b) => a.barcode.localeCompare(b.barcode, 'ru'));
      const cut = mine
        .filter((roll) => !untouched(roll))
        .sort((a, b) => b.remainingQuantity - a.remainingQuantity);
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
            <Column title="Новые, не тронутые" rolls={fresh} unit={material.unit} empty="Нет" />
            <Column title={usedTitle} rolls={cut} unit={material.unit} empty="Нет" />
          </div>
        </div>
      ))}
    </div>
  );
};

export default WorkshopMaterialRolls;
