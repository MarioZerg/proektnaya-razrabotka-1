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
  'МЕГАМАГ оборвался по таймауту. В Поехали у функции marketplace_assistant поставьте таймаут 90 секунд — как у МЕГАБУХа.';

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
  const res = await fetch(MARKETPLACE_ASSISTANT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question,
      userId,
      history: history.map(({ role: r, content }) => ({ role: r, content })),
      role,
    }),
  });
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new Error(
      res.status === 504
        ? TIMEOUT_HINT
        : `МЕГАМАГ не ответил (${res.status})`,
    );
  }
  if (!res.ok) {
    const msg = [data.error, data.errorMessage].find(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    if (res.status === 504 || (msg && /timeout/i.test(msg))) {
      throw new Error(TIMEOUT_HINT);
    }
    throw new Error(msg || `МЕГАМАГ не ответил (${res.status})`);
  }
  return data as unknown as ShopAiAnswer;
};
