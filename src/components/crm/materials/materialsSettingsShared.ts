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
}

export const emptyForm: MaterialFormState = {
  typeId: '',
  newTypeName: '',
  name: '',
  unit: 'шт',
  status: 'active',
  requiresOverlock: false,
};
