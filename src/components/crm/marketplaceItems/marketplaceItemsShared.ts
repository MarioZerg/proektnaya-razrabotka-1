export interface ItemFormState {
  name: string;
  width: string;
  height: string;
  article: string;
  ozonSku: string;
  wbSku: string;
  /** Артикул в Яндекс Маркете. Пусто — заказы ищут товар по общему артикулу и штрихкоду. */
  ymSku: string;
  material: string;
  barcode: string;
  /** Упаковка для доставки: длина, ширина, высота в см, вес в граммах. */
  packLength: string;
  packWidth: string;
  packHeight: string;
  packWeight: string;
}

/** мм из базы -> см в форме: 350 -> "35", 125 -> "12.5". */
export const mmToCm = (mm: number | null | undefined) => (mm ? String(mm / 10) : '');

/** см из формы -> мм для базы. Пусто или ноль — null. */
export const cmToMm = (cm: string) => {
  const v = Number(cm.replace(',', '.'));
  return v > 0 ? Math.round(v * 10) : null;
};

export const toGrams = (g: string) => {
  const v = Number(g.replace(',', '.'));
  return v > 0 ? Math.round(v) : null;
};

export const emptyForm: ItemFormState = {
  name: '',
  width: '',
  height: '',
  article: '',
  ozonSku: '',
  wbSku: '',
  ymSku: '',
  material: '',
  barcode: '',
  packLength: '',
  packWidth: '',
  packHeight: '',
  packWeight: '',
};

export interface MaterialRow {
  materialId: string;
  quantity: string;
}

export const PAGE_SIZE = 24;
export const ALL_MATERIALS = '__all__';
