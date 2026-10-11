/** Полку спрашиваем один раз: дальше кладовщик меняет её сам, когда понадобится. */
export const SHELF_KEY = 'goods-manual-receive-shelf';
export const SHOP_KEY = 'goods-manual-receive-shop';

export interface CatalogHit {
  id: number;
  name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  shopId?: number | null;
}

export interface CartRow {
  key: string;
  hit: CatalogHit;
  title: string;
  storageBarcode?: string;
  orderNumber?: string;
}

export type Step = 'material' | 'width' | 'height';

export const choiceClass =
  'rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold hover:bg-muted disabled:opacity-50';
