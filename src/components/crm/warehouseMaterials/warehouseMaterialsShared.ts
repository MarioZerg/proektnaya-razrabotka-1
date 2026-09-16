import type { Material, MaterialType } from '@/lib/materialsApi';
import { formatQuantity } from '@/lib/formatQuantity';
import { getStockLevel, stockStatusClass, stockStatusLabel } from '@/lib/stockLevels';

/** Фильтр по наличию: кладовщику чаще нужны «мало» и «нет», чем полный список. */
export type StockFilter = 'all' | 'in_stock' | 'low' | 'empty';

export type WarehouseStatusKind = 'empty' | 'low' | 'medium' | 'high' | 'in_stock';

export interface WarehouseStatus {
  kind: WarehouseStatusKind;
  label: string;
  className: string;
}

/** Статус как на старой таблице: нет рулонов — «нет на складе», иначе шкала метров. */
export function warehouseStatus(item: Material): WarehouseStatus {
  if (item.warehouseRolls === 0) {
    return {
      kind: 'empty',
      label: 'Нет на складе',
      className: 'border-border text-muted-foreground',
    };
  }
  const level = getStockLevel(item.warehouseQuantity, item.unit);
  if (level) {
    return {
      kind: level,
      label: stockStatusLabel[level],
      className: stockStatusClass[level],
    };
  }
  return {
    kind: 'in_stock',
    label: 'В наличии',
    className: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
  };
}

export function matchesStockFilter(item: Material, filter: StockFilter): boolean {
  if (filter === 'all') return true;
  const kind = warehouseStatus(item).kind;
  if (filter === 'empty') return kind === 'empty';
  if (filter === 'low') return kind === 'low';
  return kind !== 'empty';
}

/** Полоса слева на карточке: цвет статуса видно на бегу, не читая бейдж. */
export const stockBarClass: Record<WarehouseStatusKind, string> = {
  empty: 'bg-muted-foreground/30',
  low: 'bg-red-500',
  medium: 'bg-amber-500',
  high: 'bg-emerald-500',
  in_stock: 'bg-emerald-500',
};

/** Цифра остатка того же цвета, что статус — без заливки всей строки. */
export const stockQtyClass: Record<WarehouseStatusKind, string> = {
  empty: 'text-muted-foreground',
  low: 'font-semibold text-red-700',
  medium: 'font-semibold text-amber-800',
  high: 'font-semibold text-emerald-800',
  in_stock: 'font-semibold',
};

export function formatRolls(count: number): string {
  return `${count} рул.`;
}

export function remainderLabel(item: Material): string {
  return `${formatQuantity(item.warehouseQuantity)} ${item.unit}`;
}

export interface MaterialTypeGroup {
  type: MaterialType;
  items: Material[];
}

export function groupByType(
  types: MaterialType[],
  materials: Material[]
): MaterialTypeGroup[] {
  return types
    .map((type) => ({
      type,
      items: materials.filter((m) => m.typeId === type.id),
    }))
    .filter((g) => g.items.length > 0);
}

/** Итог группы: складываем метраж только если единица у всех одна. */
export function typeTotals(items: Material[]): { qtyLabel: string | null; rolls: number } {
  const rolls = items.reduce((sum, m) => sum + m.warehouseRolls, 0);
  const units = new Set(items.map((m) => m.unit));
  if (units.size !== 1) return { qtyLabel: null, rolls };
  const qty = items.reduce((sum, m) => sum + m.warehouseQuantity, 0);
  return { qtyLabel: `${formatQuantity(qty)} ${items[0].unit}`, rolls };
}
