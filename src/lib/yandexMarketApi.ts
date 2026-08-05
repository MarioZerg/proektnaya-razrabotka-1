const YM_URL = 'https://functions.poehali.dev/27689c0a-e080-4c26-b433-8e0979079d19';

export interface YmUnmatchedOrder {
  orderId: number;
  offerId: string | null;
  shopSku: string | null;
}

export interface YmSyncResult {
  created: number;
  matchedFromStock: number;
  skippedExisting: number;
  skippedNoItem: number;
  unmatched: YmUnmatchedOrder[];
  orders: string[];
}

/** Загружает новые заказы Яндекс Маркета на конвейер. Вещи одного заказа покупателя
 * связываются общим ключом группы — по цеху они едут вместе, под один общий ярлык. */
export const syncYandexOrders = async (actor?: {
  id?: number | null;
  name?: string | null;
}): Promise<YmSyncResult> => {
  const res = await fetch(YM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sync', actorId: actor?.id, actorName: actor?.name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка Яндекс Маркета');
  return data;
};

/** Проверка подключения: сколько заказов ждёт сборки и сколько из них многотоварные. */
export const checkYandexOrders = async (): Promise<{
  ok: boolean;
  ordersAwaiting: number;
  multiItemOrders: number;
}> => {
  const res = await fetch(`${YM_URL}?action=check`);
  return res.json();
};
