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

export const statusVariant: Record<string, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  Новый: 'secondary',
  Завершено: 'default',
  Отклонена: 'destructive',
};