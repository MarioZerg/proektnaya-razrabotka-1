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
  hasMovements: boolean;
  /** Сумма остатков рулонов на складе (status='in_storage') — появляется после подтверждения приёмки от поставщика. */
  warehouseQuantity: number;
  /** Количество рулонов на складе (status='in_storage'). */
  warehouseRolls: number;
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

/** Одна строка справочника упаковки: для такой ткани и такой ширины — такой пакет. */
export interface PackagingRow {
  fabric: string;
  width: number;
  bag: string;
  itemsCount: number;
}

export interface PackagingGuide {
  rows: PackagingRow[];
  fabrics: string[];
  widths: number[];
  bags: string[];
}

/** Справочник «какой пакет к какому товару» для упаковщицы. */
export const fetchPackagingGuide = async (): Promise<PackagingGuide> => {
  const res = await fetch(`${MATERIALS_URL}?view=packaging`);
  const data = await res.json();
  return {
    rows: data.rows || [],
    fabrics: data.fabrics || [],
    widths: data.widths || [],
    bags: data.bags || [],
  };
};

/** Удаление группы материалов. Разрешено только для пустой группы — если в ней есть
 * материалы, сервер вернёт ошибку и подскажет перенести их. */
export const deleteMaterialType = async (id: number) => {
  const res = await fetch(MATERIALS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete_type', id }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось удалить группу');
  return data;
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
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Не удалось удалить материал');
  }
  return data;
};