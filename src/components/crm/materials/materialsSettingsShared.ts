import type { MaterialShop } from '@/lib/materialsApi';

/** Значение пункта «создать новый тип» в выпадающем списке типов. */
export const NEW_TYPE_VALUE = '__new__';

/** Сколько материалов показываем на одной странице справочника. */
export const PAGE_SIZE = 10;

export interface MaterialFormState {
  typeId: string;
  newTypeName: string;
  name: string;
  unit: string;
  status: 'active' | 'archive';
  requiresOverlock: boolean;
  /**
   * Магазины, которым подходит материал, и обработка края для каждого.
   *
   * Пустой список — материал общий: подходит всем магазинам. Так остаются
   * рабочими все ткани, заведённые до разделения, — их не нужно перенастраивать.
   */
  shops: MaterialShop[];
}

export const emptyForm: MaterialFormState = {
  typeId: '',
  newTypeName: '',
  name: '',
  unit: 'шт',
  status: 'active',
  requiresOverlock: false,
  shops: [],
};

/** Отмечен ли магазин у материала. */
export const isShopPicked = (shops: MaterialShop[], shopId: number): boolean =>
  shops.some((s) => s.shopId === shopId);

/** Нужен ли оверлок этому магазину. */
export const shopNeedsOverlock = (shops: MaterialShop[], shopId: number): boolean =>
  shops.find((s) => s.shopId === shopId)?.requiresOverlock === true;

/** Включить или убрать магазин, сохранив его настройку обработки края. */
export const toggleShop = (shops: MaterialShop[], shopId: number): MaterialShop[] =>
  isShopPicked(shops, shopId)
    ? shops.filter((s) => s.shopId !== shopId)
    : [...shops, { shopId, requiresOverlock: false }];

/** Переключить обработку края у конкретного магазина. */
export const setShopOverlock = (
  shops: MaterialShop[],
  shopId: number,
  requiresOverlock: boolean
): MaterialShop[] =>
  shops.map((s) => (s.shopId === shopId ? { ...s, requiresOverlock } : s));
