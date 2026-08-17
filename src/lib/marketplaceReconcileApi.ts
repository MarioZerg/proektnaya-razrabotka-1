const RECONCILE_URL = 'https://functions.poehali.dev/6d6d5a20-18e6-4dea-8ec5-ffef149f45fa';

/** Одна строка сверки: сколько заказов на площадке и сколько доехало до нас. */
export interface ReconcileRow {
  title: string;
  onMarketplace: number;
  inSystem: number;
  /** Сколько заказов есть на площадке, но нет у нас. Больше нуля — заказы теряются. */
  missing: number;
}

export interface ReconcileMarketplace {
  key: string;
  title: string;
  enabled: boolean;
  /** Площадка не ответила — сверить не удалось (это не значит, что заказы потеряны). */
  error?: string;
  rows: ReconcileRow[];
}

/**
 * Сверка с маркетплейсом: заказы на площадке против заказов у нас.
 *
 * Площадки опрашиваем по одной: опрос всех трёх разом не укладывается в отведённое
 * время, и страница не получала бы ничего.
 */
export const fetchReconcile = async (
  marketplace: 'ozon' | 'wb' | 'ym',
): Promise<ReconcileMarketplace> => {
  const res = await fetch(`${RECONCILE_URL}?marketplace=${marketplace}`);
  if (!res.ok) throw new Error('Не удалось сверить с площадкой');
  const data = await res.json();
  return data.marketplaces?.[0];
};
