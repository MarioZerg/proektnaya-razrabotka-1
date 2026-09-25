import type { ItemRow } from '@/components/crm/shipments/fromSupplierShared';

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
    .filter((r) => r.materialId && num(r.quantity) > 0)
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
        // Поставщик строки. Пусто — берётся основной поставщик приёмки.
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
      return !(r.materialId && num(r.quantity) > 0);
    })
    .map(({ r, i }) =>
      !r.materialId
        ? `строка ${i}: не выбран материал`
        : `строка ${i}: метраж не указан или не больше нуля`,
    );
