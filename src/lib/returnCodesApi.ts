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
}

export const fetchReturnCodes = async (): Promise<ReturnPickupCode[]> => {
  const res = await fetch(RETURN_CODES_URL);
  const data = await res.json();
  return data.items || [];
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
