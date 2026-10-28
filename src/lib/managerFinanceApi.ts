const MANAGER_FINANCE_URL =
  'https://functions.poehali.dev/406daf92-dd75-4e27-946d-e90aa720fe70';

/** POEHALI: выкупы. FRONTEND-ONLY: сбой ленты не писать как «выкупов нет». */

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(MANAGER_FINANCE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

/** Выкупленный заказ: что купили, почём и сколько на этом заработали. */
export interface BoughtOrder {
  id: number;
  orderNumber: string | null;
  marketplace: string;
  scheme: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  quantity: number;
  soldAt: string | null;
  sku: string | null;
  /** Цена, по которой покупатель оформил заказ. */
  price: number | null;
  /** Маржа из юнит-экономики — та же, что в разделе цен. */
  margin: number | null;
  profit: number | null;
  /**
   * Цена на витрине до СПП — скидки Озон Картой.
   *
   * Покупатель видит одну цену, платит меньше, а разницу площадка возмещает
   * продавцу. Без этой строки непонятно, почему начислено меньше карточки.
   */
  cardPrice?: number | null;
}

/**
 * Лента выкупленных заказов.
 *
 * Только те, что покупатель реально забрал: заказ в доставке ещё может
 * вернуться, и считать его выручкой рано.
 */
export const fetchBoughtFeed = (
  page = 1,
  perPage = 10,
  /** Отбор по дате выкупа, ГГГГ-ММ-ДД. Обе границы включительно. */
  dateFrom = '',
  dateTo = '',
  /** Площадка: ozon, wildberries, yandex_market. Пусто — все. */
  marketplace = '',
  /** Схема: FBO (со склада площадки) или FBS (со своего). Пусто — обе. */
  scheme = '',
): Promise<{
  items: BoughtOrder[];
  page: number;
  perPage: number;
  total: number;
  pages: number;
  /** Итог по всему отбору, а не по видимой странице. */
  totals: {
    revenue: number;
    profit: number;
    margin: number;
    /** Выручка, по которой удалось разложить расходы. */
    knownRevenue?: number;
    /** Куда ушла выручка: по статьям, в рублях. */
    breakdown?: Record<string, number>;
    /** Фактическая доля удержания площадки, % — из отчёта о реализации. */
    feeShare?: number;
    /**
     * Итоги по каждой схеме продажи — FBO и FBS рядом.
     *
     * Приходят всегда, даже когда выбран один срез: сравнивать схемы нужно
     * одновременно, а не переключаясь между ними и запоминая цифры.
     */
    schemes?: {
      scheme: string;
      quantity: number;
      revenue: number;
      profit: number;
      margin: number;
      feeShare: number | null;
    }[];
    /**
     * Оплачено баллами Ozon — справочно.
     *
     * Это способ оплаты, а не отдельный доход: покупатель платит ту же цену,
     * просто часть баллами, и вознаграждение площадки берётся с полной цены.
     */
    bonus?: { points: number; bank: number };
  };
  /** Сколько выкупов по каждой площадке и схеме — для переключателей. */
  breakdown: { marketplace: string; scheme: string; count: number }[];
}> =>
  fetch(
    `${MANAGER_FINANCE_URL}?action=bought_feed&page=${page}` +
      `&perPage=${perPage}` +
      (dateFrom ? `&dateFrom=${dateFrom}` : '') +
      (dateTo ? `&dateTo=${dateTo}` : '') +
      (marketplace ? `&marketplace=${marketplace}` : '') +
      (scheme ? `&scheme=${scheme}` : ''),
  ).then((r) => r.json());

/**
 * Подтянуть свежие продажи с площадки прямо сейчас.
 *
 * Планировщик обновляет их дважды в сутки, но при разборе «сколько заработали
 * вчера» ждать полсуток незачем. Выгрузка идёт страницами несколько минут и
 * продолжает себя сама — ответ приходит сразу, до окончания работы.
 */
export const refreshSales = (months = 1): Promise<{ started: boolean }> =>
  post({ action: 'refresh_sales', months });