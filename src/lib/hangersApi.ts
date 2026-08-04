const HANGERS_URL = 'https://functions.poehali.dev/85bbeb23-4daf-48af-943e-69237b89bdeb';

export interface Hanger {
  id: number;
  number: number;
}

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

export const createHanger = (number: number) => post({ action: 'create', number });

export const deleteHanger = (id: number) => post({ action: 'delete', id });
