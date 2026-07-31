const WORKSHOP_MATERIALS_URL = 'https://functions.poehali.dev/db49c8fd-1344-4e72-a6e8-5a2c90a2656a';

export interface WorkshopMaterialShift {
  shiftNumber: number | null;
  quantity: number;
  rollCount: number;
}

export interface WorkshopMaterialRow {
  materialId: number;
  materialName: string;
  unit: string;
  shifts: WorkshopMaterialShift[];
  totalQuantity: number;
  totalRolls: number;
}

export interface WorkshopMaterialType {
  id: number;
  name: string;
  materials: WorkshopMaterialRow[];
}

export const fetchWorkshopMaterials = async (workshopId?: number): Promise<WorkshopMaterialType[]> => {
  const url = workshopId ? `${WORKSHOP_MATERIALS_URL}?workshop_id=${workshopId}` : WORKSHOP_MATERIALS_URL;
  const res = await fetch(url);
  const data = await res.json();
  return data.types || [];
};
