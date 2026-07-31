const SHELVES_URL = 'https://functions.poehali.dev/06b83d03-2e1c-4061-972d-a39d81cf0b2d';

export interface Shelf {
  id: number;
  name: string;
  createdAt: string;
  itemsCount: number;
}

export const fetchShelves = async (): Promise<Shelf[]> => {
  const res = await fetch(SHELVES_URL);
  const data = await res.json();
  return data.shelves || [];
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(SHELVES_URL, {
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

export const createShelf = (name: string) => postAction({ action: 'create', name });
export const deleteShelf = (id: number) => postAction({ action: 'delete', id });
