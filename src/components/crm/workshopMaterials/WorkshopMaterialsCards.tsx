import { Badge } from '@/components/ui/badge';
import { formatQuantity } from '@/lib/formatQuantity';
import { getStockLevel, stockCellClass } from '@/lib/stockLevels';
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
 * Телефон: таблица смен цеха не помещается и страницу приходится двигать вправо.
 * Карточки — материал сверху, смены столбиком, всё читается без боковой прокрутки.
 */
const WorkshopMaterialsCards = ({
  types,
  visibleColumns,
  showWorkshopName,
  showTotal,
  isActiveColumn,
  totalFor,
}: WorkshopMaterialsCardsProps) => (
  <div className="space-y-4">
    {types.map((type) => (
      <div key={type.id} className="space-y-2">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <span className="text-sm font-semibold">{type.name}</span>
          <Badge variant="secondary">{type.materials.length} поз.</Badge>
        </div>
        <div className="space-y-2">
          {type.materials.map((m) => {
            const total = totalFor(m);
            return (
              <div
                key={m.materialId}
                className="min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3"
              >
                <div className="break-words font-semibold leading-snug">{m.materialName}</div>
                <div className="mt-2 space-y-1.5">
                  {visibleColumns.map((col) => {
                    const cell = m.cells.find(
                      (c) =>
                        c.workshopId === col.workshopId && c.shiftNumber === col.shiftNumber,
                    );
                    const level = cell ? getStockLevel(cell.quantity, m.unit) : null;
                    return (
                      <div
                        key={`${col.workshopId}-${col.shiftNumber}`}
                        className={`rounded-md px-2.5 py-1.5 ${
                          isActiveColumn(col) ? 'ring-2 ring-primary' : ''
                        } ${level ? stockCellClass[level] : cell ? 'bg-muted/50' : 'bg-muted/30'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 text-xs leading-snug">
                            {showWorkshopName && (
                              <div className="text-muted-foreground">{col.workshopName}</div>
                            )}
                            <div>{col.shiftLabel}</div>
                          </div>
                          <div className="shrink-0 text-right text-sm tabular-nums">
                            {cell ? qtyLine(cell.quantity, m.unit, cell.rollCount) : '—'}
                          </div>
                        </div>
                        {(cell?.pendingQuantity ?? 0) > 0 && (
                          <div className="mt-0.5 text-right text-xs font-medium text-amber-700">
                            в пути: {formatQuantity(cell?.pendingQuantity ?? 0)} {m.unit}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {showTotal && (
                    <div
                      className={`rounded-md px-2.5 py-1.5 font-semibold ${(() => {
                        const lvl = getStockLevel(total.quantity, m.unit);
                        return lvl ? stockCellClass[lvl] : 'bg-muted/40';
                      })()}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs">Итого</div>
                        <div className="text-right text-sm tabular-nums">
                          {qtyLine(total.quantity, m.unit, total.rolls)}
                        </div>
                      </div>
                      {total.pending > 0 && (
                        <div className="mt-0.5 text-right text-xs font-medium text-amber-700">
                          в пути: {formatQuantity(total.pending)} {m.unit}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ))}
  </div>
);

export default WorkshopMaterialsCards;
