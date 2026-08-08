const WORKSHOP_MATERIALS_URL = 'https://functions.poehali.dev/db49c8fd-1344-4e72-a6e8-5a2c90a2656a';

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
}

export const fetchWorkshopMaterials = async (workshopId?: number): Promise<WorkshopMaterialsResponse> => {
  const url = workshopId ? `${WORKSHOP_MATERIALS_URL}?workshop_id=${workshopId}` : WORKSHOP_MATERIALS_URL;
  const res = await fetch(url);
  const data = await res.json();
  return { types: data.types || [], columns: data.columns || [], activeColumn: data.activeColumn || null };
};
