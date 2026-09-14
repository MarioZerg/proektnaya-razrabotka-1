const MATERIALS_URL = 'https://functions.poehali.dev/642e7cf2-2a7e-4c6e-81c6-c31c19737524';

import type { Shop } from '@/lib/marketplaceIntegrationsApi';

export type { Shop };

export interface MaterialType {
  id: number;
  name: string;
  sortOrder: number;
}

/**
 * ПРИВЯЗКА МАТЕРИАЛА К МАГАЗИНУ.
 *
 * Ассортимент у МЕГАТЮЛЬ и ДЮНЫ разный, а обработка бокового шва у одной и той
 * же ткани может отличаться: где-то её обмётывают на оверлоке (отдельный этап и
 * отдельное начисление), где-то шьют обычной прямострочкой. Поэтому признак
 * оверлока живёт не на материале, а здесь — у пары «материал + магазин».
 */
export interface MaterialShop {
  shopId: number;
  requiresOverlock: boolean;
}

export interface Material {
  id: number;
  typeId: number;
  name: string;
  unit: string;
  /**
   * Средняя себестоимость единицы по рулонам на складе и в цехах — только для справки.
   * Вручную не задаётся: цену материала определяет прайс поставщика, а точная себестоимость
   * (цена × курс + логистика) считается при приёмке и хранится на каждом рулоне.
   */
  avgCost: number;
  status: 'active' | 'archive';
  sortOrder: number;
  hasMovements: boolean;
  /** Сумма остатков рулонов на складе (status='in_storage') — появляется после подтверждения приёмки от поставщика. */
  warehouseQuantity: number;
  /** Количество рулонов на складе (status='in_storage'). */
  warehouseRolls: number;
  /**
   * Ткань с осыпающимся краем: заказ из неё сначала обмётывают на оверлоке и
   * только потом отдают швее на прямострочку.
   *
   * Общая настройка «на весь цех». Работает как запасная: если у материала
   * заданы магазины, решает настройка магазина (см. shops).
   */
  requiresOverlock?: boolean;
  /**
   * Каким магазинам подходит материал и нужен ли им оверлок.
   * Пустой список — материал общий, подходит всем магазинам.
   */
  shops?: MaterialShop[];
}

export interface MaterialsData {
  types: MaterialType[];
  materials: Material[];
  /** Активные магазины — галочки в карточке материала. */
  shops: Shop[];
}

export const fetchMaterialsData = async (): Promise<MaterialsData> => {
  const res = await fetch(MATERIALS_URL);
  const data = await res.json();
  return {
    types: data.types || [],
    materials: data.materials || [],
    shops: data.shops || [],
  };
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
  status: string,
  requiresOverlock = false,
  shops: MaterialShop[] = []
) => {
  const res = await fetch(MATERIALS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create_material',
      typeId,
      name,
      unit,
      status,
      requiresOverlock,
      shops,
    }),
  });
  return res.json();
};

export const updateMaterial = async (
  id: number,
  fields: Partial<{
    name: string;
    unit: string;
    status: string;
    typeId: number;
    requiresOverlock: boolean;
    /** Полный список магазинов материала — сервер перезаписывает привязку целиком. */
    shops: MaterialShop[];
  }>
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