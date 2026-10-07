import type { CostGroup } from '@/lib/productCostApi';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Пересчёт карточки под цену ткани из поставки.
 * Работа и накладные не зависят от метра — их не трогаем.
 */
export const applyFabricPrice = (g: CostGroup, price: number): CostGroup => {
  const materials = g.materials.map((m) => {
    if (m.typeName !== 'Тюль') return m;
    return {
      ...m,
      pricePerUnit: price,
      sum: round2(m.quantity * price),
      priceSource: 'supply' as const,
    };
  });
  const fabricCost = round2(materials.filter((m) => m.typeName === 'Тюль').reduce((s, m) => s + m.sum, 0));
  const trimCost = round2(materials.filter((m) => m.typeName === 'Аксессуары').reduce((s, m) => s + m.sum, 0));
  const packCost = round2(materials.filter((m) => m.typeName === 'Упаковка').reduce((s, m) => s + m.sum, 0));
  const materialsCost = round2(fabricCost + trimCost + packCost);
  const shortageCost = round2(materialsCost * (g.shortagePercent ?? 5) / 100);
  return {
    ...g,
    materials,
    fabricCost,
    trimCost,
    packCost,
    materialsCost,
    shortageCost,
    total: round2(materialsCost + shortageCost + g.laborCost + g.overhead),
  };
};
