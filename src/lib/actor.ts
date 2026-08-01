/**
 * Данные текущего пользователя, автоматически подмешиваемые в каждый POST-запрос
 * к backend для журнала действий (audit_log). Читаются напрямую из localStorage,
 * а не из React-контекста, чтобы withActor() можно было использовать в любом
 * *Api.ts файле без риска циклических импортов.
 */
const STORAGE_KEY = 'megatul_user';

interface StoredUser {
  id: number;
  name: string;
}

export const getCurrentActor = (): StoredUser | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.id === 'number' && typeof parsed?.name === 'string') {
      return { id: parsed.id, name: parsed.name };
    }
    return null;
  } catch {
    return null;
  }
};

/** Добавляет к телу запроса actorId/actorName текущего пользователя для журнала действий. */
export const withActor = (payload: Record<string, unknown>): Record<string, unknown> => {
  const actor = getCurrentActor();
  if (!actor) return payload;
  return { ...payload, actorId: actor.id, actorName: actor.name };
};
