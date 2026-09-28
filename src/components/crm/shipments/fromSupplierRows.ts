import { emptyRow, type ItemRow } from '@/components/crm/shipments/fromSupplierShared';

// Число, записанное как угодно: «40,8» и «40.8» — одно и то же. Кладовщик
// вводит метраж с бирки поставщика, а там запятая, и раньше такая строка
// молча выпадала из приёмки.
export const num = (v: string | number | null | undefined) => {
  if (v === null || v === undefined) return NaN;
  return Number(String(v).replace(',', '.').trim());
};

// ВАЖНО про количество. В форме сотрудник указывает метраж ОДНОГО рулона (как написано
// на самом рулоне) и сколько таких рулонов пришло: «100 пог.м.» и «10 рулонов» = 1000 м.
// В систему уходит общий метраж — по нему считается склад и логистика на единицу.
//
// ПУСТОЕ ЧИСЛО РУЛОНОВ = ОДИН РУЛОН. Это самая частая ситуация при разгрузке:
// один рулон — одна строка, и поле просто не заполняют. Раньше такая строка
// тихо исчезала из приёмки, а кладовщик узнавал об этом только по недостающему
// материалу на складе.
export const rowsToItems = (list: ItemRow[]) =>
  list
    .filter((r) => r.materialId && r.supplierId && num(r.quantity) > 0)
    .map((r) => {
      const rolls = num(r.numberRolls) >= 1 ? Math.floor(num(r.numberRolls)) : 1;
      return {
        id: r.id,
        materialId: Number(r.materialId),
        quantity: num(r.quantity) * rolls,
        numberRolls: rolls,
        // Цена за единицу в валюте поставщика. Пусто — подставится прайс поставщика.
        price: r.price && r.price.trim() !== '' ? num(r.price) : null,
        currency: r.currency || null,
        // Поставщик этой позиции. Кладовщик указывает его у каждого материала:
        // в одной машине бывают разные поставщики или один на все ткани.
        supplierId: r.supplierId ? Number(r.supplierId) : null,
      };
    });

/** Заполненные строки, которые всё же не попадут в приёмку — чтобы сказать почему. */
export const droppedRows = (list: ItemRow[]) =>
  list
    .map((r, i) => ({ r, i: i + 1 }))
    .filter(({ r }) => {
      const touched = r.materialId || (r.quantity && r.quantity.trim() !== '');
      if (!touched) return false; // пустая строка-заготовка — молчим
      return !(r.materialId && r.supplierId && num(r.quantity) > 0);
    })
    .map(({ r, i }) =>
      !r.materialId
        ? `строка ${i}: не выбран материал`
        : !r.supplierId
          ? `строка ${i}: не выбран поставщик`
          : `строка ${i}: метраж не указан или не больше нуля`,
    );

/** Поставщик документа для API: сервер всё ещё ждёт один supplierId на приёмку. */
export const documentSupplierId = (items: { supplierId?: number | null }[]) =>
  items.find((i) => i.supplierId)?.supplierId ?? null;

/**
 * Соседние строки одного материала и поставщика — один блок в форме.
 *
 * FRONTEND-ONLY: на сервер по-прежнему уходит плоский список позиций.
 * Группировка только чтобы не выбирать ткань и поставщика на каждый рулон.
 */
export const groupRowIndices = (rows: ItemRow[]): number[][] => {
  const groups: number[][] = [];
  rows.forEach((row, idx) => {
    if (!row.materialId) {
      groups.push([idx]);
      return;
    }
    const last = groups[groups.length - 1];
    const head = last ? rows[last[0]] : null;
    if (
      last &&
      head?.materialId === row.materialId &&
      (head.supplierId || '') === (row.supplierId || '')
    ) {
      last.push(idx);
    } else {
      groups.push([idx]);
    }
  });
  return groups;
};

/** Плюс в блоке: ещё одна строка метража того же материала. */
export const addLineToGroup = (rows: ItemRow[], group: number[]): ItemRow[] => {
  const lastIdx = group[group.length - 1];
  const src = rows[lastIdx];
  const next: ItemRow = {
    ...emptyRow,
    materialId: src.materialId,
    supplierId: src.supplierId || '',
    currency: src.currency || '',
  };
  return [...rows.slice(0, lastIdx + 1), next, ...rows.slice(lastIdx + 1)];
};

/** Материал или поставщик блока — сразу на все его строки. */
export const setGroupField = (
  rows: ItemRow[],
  group: number[],
  field: 'materialId' | 'supplierId',
  value: string,
): ItemRow[] => rows.map((row, i) => (group.includes(i) ? { ...row, [field]: value } : row));

/** Новый материал: того же поставщика, что у предыдущего блока — часто так и есть. */
export const addMaterialGroup = (rows: ItemRow[]): ItemRow[] => {
  const last = rows[rows.length - 1];
  return [...rows, { ...emptyRow, supplierId: last?.supplierId || '' }];
};
