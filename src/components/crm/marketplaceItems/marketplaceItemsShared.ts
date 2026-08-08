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
}

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
};

export interface MaterialRow {
  materialId: string;
  quantity: string;
}

export const PAGE_SIZE = 24;
export const ALL_MATERIALS = '__all__';
