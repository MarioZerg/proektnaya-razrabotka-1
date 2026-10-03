import type { Role } from '@/lib/roles';
import type { AiMessage } from '@/lib/aiAssistantApi';

/**
 * Живая функция marketplace_assistant (Поехали).
 * Ключи OZON/WB/YM берёт из вкладки интеграций.
 * Секреты функции: DATABASE_URL, API_KEY_MEGAMAG (запасной AITUNNEL_API_KEY).
 */
export const MARKETPLACE_ASSISTANT_URL =
  'https://functions.poehali.dev/031fc26f-9279-450e-a606-c662b07fe128';

export interface ShopAiAnswer {
  answer: string;
  queries?: string[];
  model?: string;
}

const TIMEOUT_HINT =
  'МЕГАМАГ оборвался по таймауту шлюза Поехали (~30 с). Спросите короче или напишите «продолжи».';

const FETCH_HINT =
  'Нет ответа от МЕГАМАГа (обрыв сети или шлюз Поехали). Повторите вопрос; если снова — опубликуйте свежую функцию marketplace_assistant.';

export const askMarketplaceAssistant = async (
  question: string,
  userId: number,
  history: AiMessage[] = [],
  role?: Role,
): Promise<ShopAiAnswer> => {
  if (!MARKETPLACE_ASSISTANT_URL) {
    throw new Error(
      'МЕГАМАГ ещё не подключён: опубликуйте функцию marketplace_assistant на Поехали и вставьте URL в marketplaceAssistantApi.ts.',
    );
  }
  let res: Response;
  try {
    res = await fetch(MARKETPLACE_ASSISTANT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        userId,
        history: history.map(({ role: r, content }) => ({ role: r, content })),
        role,
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/failed to fetch|networkerror|load failed|aborted/i.test(msg)) {
      throw new Error(FETCH_HINT);
    }
    throw e instanceof Error ? e : new Error(FETCH_HINT);
  }
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new Error(
      res.status === 504 || res.status === 502 || res.status === 499
        ? TIMEOUT_HINT
        : `МЕГАМАГ не ответил (${res.status})`,
    );
  }
  if (!res.ok) {
    const msg = [data.error, data.errorMessage].find(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    if (
      res.status === 504 ||
      res.status === 502 ||
      res.status === 499 ||
      (msg && /timeout|499|503/i.test(msg))
    ) {
      throw new Error(TIMEOUT_HINT);
    }
    throw new Error(msg || `МЕГАМАГ не ответил (${res.status})`);
  }
  return data as unknown as ShopAiAnswer;
};
