const HANGERS_URL = 'https://functions.poehali.dev/85bbeb23-4daf-48af-943e-69237b89bdeb';

export interface Hanger {
  id: number;
  number: number;
  /** Название вешалки («Синяя у окна»). Пустое — показываем номер. */
  name?: string;
}

/** Как вешалка выглядит для человека: название, а если его нет — номер. */
export const hangerLabel = (h: { number: number; name?: string }) =>
  h.name?.trim() ? h.name : `№ ${h.number}`;

/** Подпись вешалки в карточке заказа. Вешалки нет — прочерк. */
export const orderHangerLabel = (o: { hangerNumber: number; hangerName?: string | null }) => {
  if (o.hangerName?.trim()) return o.hangerName;
  return o.hangerNumber > 0 ? `№ ${o.hangerNumber}` : '—';
};

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(HANGERS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

export const fetchHangers = async (): Promise<Hanger[]> => {
  const res = await fetch(HANGERS_URL);
  const data = await res.json();
  return data.hangers || [];
};

export const createHanger = (name: string, number?: number) =>
  post({ action: 'create', name, number });

export const renameHanger = (id: number, name: string) =>
  post({ action: 'rename', id, name });

export const deleteHanger = (id: number) => post({ action: 'delete', id });
