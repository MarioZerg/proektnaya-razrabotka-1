import type { SupplyItem } from '@/lib/marketplaceSuppliesApi';

/** Строка списка: либо уже отсканированная вещь, либо та, что ещё ждёт на складе. */
export interface Row {
  key: string;
  scanned: boolean;
  orderNumber: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  labeledByName: string | null;
  shelfName?: string | null;
  /** Стикер связки (YM-…) — им сканируют вещь в поставку. */
  bundleBarcode?: string | null;
  item?: SupplyItem;
  /** Связка Яндекса: строки с одним ключом показываются под общей шапкой. */
  groupKey?: string | null;
  /**
   * Вещь, отсканированную последней, показываем первой строкой и подсвечиваем.
   *
   * Кладовщик должен сразу видеть, ЧТО он только что положил в короб — тот ли
   * размер. Иначе ошибку замечают уже на складе площадки.
   */
  justScanned?: boolean;
}

export const sizeOf = (w: number | null, h: number | null) => (w && h ? `${w}×${h}` : '—');
