const SHELVES_URL = 'https://functions.poehali.dev/06b83d03-2e1c-4061-972d-a39d81cf0b2d';

/** POEHALI: полки склада. FRONTEND-ONLY: сбой GET не писать как «полок нет». */

export interface Shelf {
  id: number;
  name: string;
  createdAt: string;
  itemsCount: number;
  /** Адрес снимка, где стоит контейнер. Нет поля — кладовщик фото не ставил. */
  photoUrl?: string | null;
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

export const createShelf = (name: string, actorId?: number) =>
  postAction({ action: 'create', name, actorId });
export const deleteShelf = (id: number, actorId?: number) =>
  postAction({ action: 'delete', id, actorId });
/** Переименовать полку: названия на стеллажах меняются, а удалять полку с товаром нельзя. */
export const renameShelf = (id: number, name: string, actorId?: number) =>
  postAction({ action: 'rename', id, name, actorId });

/**
 * Сжимает снимок полки до jpeg.
 *
 * Телефон снимает кадр на несколько мегабайт. На карточке товара это просто
 * пометка «контейнер стоит здесь» — большой файл не нужен и не пройдёт в вызов.
 */
export const compressShelfPhoto = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1200;
      let w = img.width;
      let h = img.height;
      if (w > max || h > max) {
        const scale = Math.min(max / w, max / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('Не удалось сжать фото'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось открыть изображение'));
    };
    img.src = url;
  });

/** Поставить или заменить снимок полки. В ответ приходит адрес, список заново не грузим. */
export const setShelfPhoto = async (id: number, photo: string, actorId?: number) => {
  const data = await postAction({ action: 'set_photo', id, photo, actorId });
  return String(data.photoUrl || '');
};

export const clearShelfPhoto = (id: number, actorId?: number) =>
  postAction({ action: 'clear_photo', id, actorId });