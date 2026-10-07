export interface ItemRow {
  /** id позиции в базе — по нему за строкой сохраняются уже напечатанные штрихкоды. */
  id?: number;
  materialId: string;
  quantity: string;
  numberRolls: string;
  /**
   * Поставщик этого материала. Обязателен: в одной машине бывают разные
   * поставщики или один на все ткани. Без него позиция в приёмку не уйдёт.
   */
  supplierId?: string;
  /** Штрихкоды, забронированные под эту позицию: их печатают сразу при разгрузке. */
  reservedBarcodes?: string[];
  /** Цена за единицу в валюте поставщика — заполняет администратор при проверке.
   * Пусто — подставится цена из прайса поставщика. */
  price?: string;
  currency?: string;
}

export const emptyRow: ItemRow = {
  materialId: '',
  quantity: '',
  numberRolls: '',
  supplierId: '',
  price: '',
  currency: '',
};

/**
 * Себестоимость 1 единицы в рублях: цена в валюте умножается на курс, сверху ложится
 * логистика, разделённая поровну на все метры и штуки поставки.
 * У рублёвых позиций (тесьма, пакеты) курс не применяется.
 */
export const calcCostPerUnit = (
  price: number,
  currency: string,
  exchangeRate: number,
  logisticsPerUnit: number
): number => {
  const rate = currency && currency !== 'RUB' ? exchangeRate || 1 : 1;
  return price * rate + logisticsPerUnit;
};

export { formatDateTime as formatDate } from '@/lib/dateUtils';

export const moneyRub = (n: number) =>
  `${n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;

/** Полная себестоимость рулона: цена единицы × метраж в строке приёмки. */
export const rollTotalCost = (
  costPerUnit: number | null | undefined,
  quantity: number | null | undefined,
): number | null => {
  if (costPerUnit == null || quantity == null) return null;
  return costPerUnit * quantity;
};

export const statusVariant: Record<string, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  Новый: 'secondary',
  Завершено: 'default',
  Отклонена: 'destructive',
};

export const accountantStatusLabel: Record<string, string> = {
  pending: 'Ждёт бухгалтера',
  confirmed: 'Бухгалтер подтвердила',
  correction: 'На корректировке',
};

export const accountantStatusVariant: Record<string, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  pending: 'outline',
  confirmed: 'default',
  correction: 'destructive',
};