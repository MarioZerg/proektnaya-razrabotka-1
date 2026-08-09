const RETURN_CODES_URL = 'https://functions.poehali.dev/5700d90e-2549-41b2-80f3-ec7984cdea1b';

/** Штрихкод кабинета продавца для получения возвратов на ПВЗ. */
export interface ReturnPickupCode {
  marketplaceCode: string;
  title: string;
  /** Значение кода. Пусто — администратор ещё не заполнил. */
  code: string | null;
  /** Формат: CODE128, EAN13 или QR — зависит от площадки. */
  codeType: string;
  comment: string;
  updatedAt: string | null;
  /** Сколько возвратов уже одобрено и ждёт забора на ПВЗ этой площадки. */
  waitingCount: number;
  /** Готовая картинка штрихкода от маркетплейса (base64 PNG). */
  codeImage: string | null;
  /** Код обновляется раз в сутки (OZON) — вчерашний на ПВЗ не примут. */
  dailyRefresh: boolean;
  /** Код обновляли сегодня. */
  updatedToday: boolean;
}

export const fetchReturnCodes = async (): Promise<{
  items: ReturnPickupCode[];
  totalWaiting: number;
}> => {
  const res = await fetch(RETURN_CODES_URL);
  const data = await res.json();
  return { items: data.items || [], totalWaiting: data.totalWaiting || 0 };
};

export const saveReturnCode = async (payload: {
  marketplaceCode: string;
  code: string;
  codeType?: string;
  comment?: string;
  actorId?: number | null;
}) => {
  const res = await fetch(RETURN_CODES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save', ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось сохранить код');
  return data;
};

/**
 * Обновить код возвратов.
 * readOnly=true — просто прочитать действующий код (автоподтягивание),
 * иначе маркетплейс выпустит НОВЫЙ код, а старый перестанет работать.
 */
export const refreshReturnCode = async (
  marketplaceCode: string,
  actorId?: number | null,
  readOnly = false,
) => {
  const res = await fetch(RETURN_CODES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'refresh', marketplaceCode, actorId, readOnly }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось обновить код');
  return data as { code: string };
};

/** Отправление возвратов, готовое к выдаче по штрихкоду. */
export interface ReturnGiveout {
  giveoutId: number | null;
  placeName: string;
  count: number;
  status: string;
}

/** Что и где ждёт получения на пунктах выдачи OZON. */
export const fetchPickupList = async (): Promise<{
  giveouts: ReturnGiveout[];
  total: number;
}> => {
  const res = await fetch(RETURN_CODES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pickup_list' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить список');
  return { giveouts: data.giveouts || [], total: data.total || 0 };
};

/** Ход приёмки: сколько коробок уже отсканировал сотрудник пункта выдачи. */
export interface GiveoutProgress {
  giveoutId: number;
  status: string;
  total: number;
  scanned: number;
  items: { name: string; approved: boolean }[];
}

export const fetchGiveoutProgress = async (giveoutId: number): Promise<GiveoutProgress> => {
  const res = await fetch(RETURN_CODES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'giveout_progress', giveoutId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось получить ход приёмки');
  return data;
};
