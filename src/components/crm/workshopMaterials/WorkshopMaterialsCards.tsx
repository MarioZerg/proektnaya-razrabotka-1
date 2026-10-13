import { useState } from 'react';
import Icon from '@/components/ui/icon';
import { formatQuantity } from '@/lib/formatQuantity';
import { getStockLevel, stockCellClass } from '@/lib/stockLevels';
import WorkshopMaterialRolls from '@/components/crm/workshopMaterials/WorkshopMaterialRolls';
import type {
  WorkshopMaterialColumn,
  WorkshopMaterialRow,
  WorkshopMaterialType,
} from '@/lib/workshopMaterialsApi';

interface WorkshopMaterialsCardsProps {
  types: WorkshopMaterialType[];
  visibleColumns: WorkshopMaterialColumn[];
  showWorkshopName: boolean;
  showTotal: boolean;
  isActiveColumn: (col: WorkshopMaterialColumn) => boolean;
  totalFor: (m: WorkshopMaterialRow) => { quantity: number; rolls: number; pending: number };
}

const qtyLine = (quantity: number, unit: string, rolls: number) =>
  `${formatQuantity(quantity)} ${unit} · ${rolls} рул.`;

/**
 * Телефон: та же таблица цеха, только ячейки смен стоят сеткой по ширине экрана.
 * Широкая таблица уезжала вбок, а отдельный вид карточек выглядел иначе, чем склад.
 */
const WorkshopMaterialsCards = ({
  types,
  visibleColumns,
  showWorkshopName,
  showTotal,
  isActiveColumn,
  totalFor,
}: WorkshopMaterialsCardsProps) => {
  const [openId, setOpenId] = useState<number | null>(null);

  return (
  <div className="space-y-4">
    {types.map((type) => (
      <div key={type.id} className="min-w-0 overflow-hidden rounded-md border border-border">
        <div className="flex min-w-0 items-baseline justify-between gap-2 border-b border-border bg-muted/50 px-3 py-2">
          <span className="text-sm font-semibold">{type.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{type.materials.length} поз.</span>
        </div>
        <div className="divide-y divide-border">
          {type.materials.map((m) => {
            const total = totalFor(m);
            const cells = visibleColumns.length + (showTotal ? 1 : 0);
            return (
              <div key={m.materialId} className="px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setOpenId((id) => (id === m.materialId ? null : m.materialId))}
                  className="flex w-full min-w-0 items-center gap-1.5 text-left"
                >
                  <Icon
                    name="ChevronRight"
                    size={14}
                    className={`shrink-0 text-muted-foreground transition-transform ${
                      openId === m.materialId ? 'rotate-90' : ''
                    }`}
                  />
                  <span className="min-w-0 break-words text-sm font-medium leading-snug">
                    {m.materialName}
                  </span>
                  {(m.staleRolls ?? 0) > 0 && (
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-800">
                      <Icon name="Timer" size={12} />
                      простой &gt;3 дн: {m.staleRolls} рул.
                    </span>
                  )}
                </button>
                <div
                  className={`mt-2 grid gap-1.5 ${
                    cells <= 1
                      ? 'grid-cols-1'
                      : cells === 2
                        ? 'grid-cols-2'
                        : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                  }`}
                >
                  {visibleColumns.map((col) => {
                    const cell = m.cells.find(
                      (c) =>
                        c.workshopId === col.workshopId && c.shiftNumber === col.shiftNumber,
                    );
                    const level = cell ? getStockLevel(cell.quantity, m.unit) : null;
                    return (
                      <div
                        key={`${col.workshopId}-${col.shiftNumber}`}
                        className={`min-w-0 rounded-md px-2 py-1.5 ${
                          isActiveColumn(col) ? 'ring-2 ring-primary' : ''
                        } ${level ? stockCellClass[level] : cell ? 'bg-emerald-50' : 'bg-muted/40'}`}
                      >
                        <div className="text-[11px] font-normal leading-snug">
                          {showWorkshopName && (
                            <div className="truncate">{col.workshopName}</div>
                          )}
                          <div className="truncate">{col.shiftLabel}</div>
                        </div>
                        <div className="mt-0.5 break-words text-sm tabular-nums leading-snug">
                          {cell ? qtyLine(cell.quantity, m.unit, cell.rollCount) : '—'}
                        </div>
                        {(cell?.staleRolls ?? 0) > 0 && (
                          <div className="mt-0.5 text-[11px] font-medium text-red-700">
                            простой &gt;3 дн: {cell?.staleRolls} рул.
                          </div>
                        )}
                        {(cell?.pendingQuantity ?? 0) > 0 && (
                          <div className="mt-0.5 text-[11px] font-medium text-amber-700">
                            в пути: {formatQuantity(cell?.pendingQuantity ?? 0)} {m.unit}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {showTotal && (
                    <div
                      className={`min-w-0 rounded-md px-2 py-1.5 ${(() => {
                        const lvl = getStockLevel(total.quantity, m.unit);
                        return lvl ? stockCellClass[lvl] : 'bg-muted/40';
                      })()}`}
                    >
                      <div className="text-[11px] font-normal leading-snug">Итого</div>
                      <div className="mt-0.5 break-words text-sm font-semibold tabular-nums leading-snug">
                        {qtyLine(total.quantity, m.unit, total.rolls)}
                      </div>
                      {total.pending > 0 && (
                        <div className="mt-0.5 text-[11px] font-medium text-amber-700">
                          в пути: {formatQuantity(total.pending)} {m.unit}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {openId === m.materialId && (
                  <WorkshopMaterialRolls
                    material={m}
                    typeName={type.name}
                    columns={visibleColumns}
                    showWorkshopName={showWorkshopName}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    ))}
  </div>
  );
};

export default WorkshopMaterialsCards;
