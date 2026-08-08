export interface ItemRow {
  materialId: string;
  quantity: string;
  numberRolls: string;
  /** Цена за единицу в валюте поставщика — заполняет администратор при проверке.
   * Пусто — подставится цена из прайса поставщика. */
  price?: string;
  currency?: string;
}

export const emptyRow: ItemRow = {
  materialId: '',
  quantity: '',
  numberRolls: '',
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

export const statusVariant: Record<string, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  Новый: 'secondary',
  Завершено: 'default',
  Отклонена: 'destructive',
};