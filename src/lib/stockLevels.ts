/** Пороги остатка материала в погонных метрах — единые для цеха и склада. */
export const STOCK_LOW_LIMIT = 200;
export const STOCK_MEDIUM_LIMIT = 500;

export type StockLevel = 'low' | 'medium' | 'high';

/** Погонные метры в разных справочниках записаны по-разному: «п.м.» и «пог.м.». */
export const isMetersUnit = (unit?: string | null): boolean => {
  if (!unit) return true;
  const u = unit.toLowerCase().replace(/\s/g, '');
  return u.startsWith('п.м') || u.startsWith('пог.м') || u.startsWith('пм') || u.startsWith('погм');
};

/**
 * Уровень остатка материала: до 200 пог.м — мало, до 500 — средне, свыше 500 — норма.
 * Считается только для материалов в погонных метрах: штуки и килограммы этой шкалой
 * не измеряются, для них уровень не определяется.
 */
export const getStockLevel = (quantity: number, unit?: string | null): StockLevel | null => {
  if (!isMetersUnit(unit)) return null;
  if (quantity < STOCK_LOW_LIMIT) return 'low';
  if (quantity < STOCK_MEDIUM_LIMIT) return 'medium';
  return 'high';
};

/** Подсветка ячейки с остатком — для таблицы инвентаризации в цехе. */
export const stockCellClass: Record<StockLevel, string> = {
  low: 'bg-red-100 text-red-800 font-semibold',
  medium: 'bg-amber-100 text-amber-800 font-semibold',
  high: 'bg-emerald-100 text-emerald-800 font-semibold',
};

/** Текстовый статус остатка — для склада материалов (без заливки строки). */
export const stockStatusLabel: Record<StockLevel, string> = {
  low: 'Мало на складе',
  medium: 'Среднее значение',
  high: 'Нормальный остаток',
};

export const stockStatusClass: Record<StockLevel, string> = {
  low: 'bg-red-100 text-red-700 hover:bg-red-100',
  medium: 'bg-amber-100 text-amber-700 hover:bg-amber-100',
  high: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
};