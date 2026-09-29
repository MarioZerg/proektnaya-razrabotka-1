import { isRetiredWorkshop } from '@/lib/workshopsApi';

const WORKSHOP_MATERIALS_URL = 'https://functions.poehali.dev/db49c8fd-1344-4e72-a6e8-5a2c90a2656a';

/** POEHALI: остатки материалов в цехах. FRONTEND-ONLY: ошибка загрузки — только экран. */

export interface WorkshopMaterialCell {
  workshopId: number;
  shiftNumber: number | null;
  quantity: number;
  rollCount: number;
  /** Сколько из этого остатка ещё не принято сменой (материал в пути). */
  pendingQuantity?: number;
  pendingRolls?: number;
}

export interface WorkshopMaterialRow {
  materialId: number;
  materialName: string;
  unit: string;
  cells: WorkshopMaterialCell[];
  totalQuantity: number;
  totalRolls: number;
  /**
   * Отгружено в цех, но смена не подтвердила приёмку. Такой материал числится
   * на остатках, но в раскрой не идёт, пока поставку не примут.
   */
  pendingQuantity?: number;
  pendingRolls?: number;
}

export interface WorkshopMaterialType {
  id: number;
  name: string;
  materials: WorkshopMaterialRow[];
}

export interface WorkshopMaterialColumn {
  workshopId: number;
  workshopName: string;
  shiftNumber: number | null;
  shiftLabel: string;
}

export interface WorkshopMaterialsResponse {
  types: WorkshopMaterialType[];
  columns: WorkshopMaterialColumn[];
  activeColumn: { workshopId: number; shiftNumber: number | null } | null;
  /** Смены без собственного материала, по цехам: { "1": [3] }.
   * Такая смена работает материалом соседних смен и видит остатки всего цеха. */
  materialFreeShifts?: Record<string, number[]>;
}

/**
 * Живой API ещё может отдать закрытый второй цех и QA — вкладки и колонки
 * строим только по действующим. Остаток закрытых цехов в «Итого» не кладём:
 * иначе цифра больше видимых колонок, и кажется, что ткань потерялась.
 */
const withoutRetiredWorkshops = (
  data: WorkshopMaterialsResponse,
): WorkshopMaterialsResponse => {
  const columns = data.columns.filter(
    (c) => !isRetiredWorkshop({ id: c.workshopId, name: c.workshopName }),
  );
  const keepIds = new Set(columns.map((c) => c.workshopId));

  const types = data.types
    .map((type) => ({
      ...type,
      materials: type.materials
        .map((m) => {
          const cells = m.cells.filter((c) => keepIds.has(c.workshopId));
          return {
            ...m,
            cells,
            totalQuantity: cells.reduce((s, c) => s + c.quantity, 0),
            totalRolls: cells.reduce((s, c) => s + c.rollCount, 0),
            pendingQuantity: cells.reduce((s, c) => s + (c.pendingQuantity ?? 0), 0),
            pendingRolls: cells.reduce((s, c) => s + (c.pendingRolls ?? 0), 0),
          };
        })
        .filter((m) => m.cells.length > 0 || m.totalQuantity > 0),
    }))
    .filter((type) => type.materials.length > 0);

  const activeColumn =
    data.activeColumn && keepIds.has(data.activeColumn.workshopId)
      ? data.activeColumn
      : null;

  const materialFreeShifts = Object.fromEntries(
    Object.entries(data.materialFreeShifts || {}).filter(([id]) => keepIds.has(Number(id))),
  );

  return { types, columns, activeColumn, materialFreeShifts };
};

export const fetchWorkshopMaterials = async (workshopId?: number): Promise<WorkshopMaterialsResponse> => {
  if (workshopId != null && isRetiredWorkshop({ id: workshopId })) {
    return { types: [], columns: [], activeColumn: null, materialFreeShifts: {} };
  }
  const url = workshopId ? `${WORKSHOP_MATERIALS_URL}?workshop_id=${workshopId}` : WORKSHOP_MATERIALS_URL;
  const res = await fetch(url);
  const data = await res.json();
  return withoutRetiredWorkshops({
    types: data.types || [],
    columns: data.columns || [],
    activeColumn: data.activeColumn || null,
    materialFreeShifts: data.materialFreeShifts || {},
  });
};