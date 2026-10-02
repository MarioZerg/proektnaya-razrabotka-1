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
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'МЕГАМАГ не ответил');
  return data;
};
