const MATERIALS_URL = 'https://functions.poehali.dev/642e7cf2-2a7e-4c6e-81c6-c31c19737524';

export interface MaterialType {
  id: number;
  name: string;
  sortOrder: number;
}

export interface Material {
  id: number;
  typeId: number;
  name: string;
  unit: string;
  cost: number;
  status: 'active' | 'archive';
  sortOrder: number;
}

export interface MaterialsData {
  types: MaterialType[];
  materials: Material[];
}

export const fetchMaterialsData = async (): Promise<MaterialsData> => {
  const res = await fetch(MATERIALS_URL);
  const data = await res.json();
  return { types: data.types || [], materials: data.materials || [] };
};

export const createType = async (name: string) => {
  const res = await fetch(MATERIALS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create_type', name }),
  });
  return res.json();
};

export const createMaterial = async (
  typeId: number,
  name: string,
  unit: string,
  cost: number,
  status: string
) => {
  const res = await fetch(MATERIALS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create_material', typeId, name, unit, cost, status }),
  });
  return res.json();
};

export const updateMaterial = async (
  id: number,
  fields: Partial<{ name: string; unit: string; cost: number; status: string; typeId: number }>
) => {
  const res = await fetch(MATERIALS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update_material', id, ...fields }),
  });
  return res.json();
};

export const deleteMaterial = async (id: number) => {
  const res = await fetch(MATERIALS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete_material', id }),
  });
  return res.json();
};
