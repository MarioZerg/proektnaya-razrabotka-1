const AI_ASSISTANT_URL = 'https://functions.poehali.dev/c6f2fe80-681d-438f-85c6-f30503927ede';

/** Сообщение в переписке с помощником. */
export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiAnswer {
  answer: string;
  /** Запросы, которые помощник сделал к базе — показываем по кнопке «Подробнее». */
  queries?: string[];
  model?: string;
}

/**
 * Спросить помощника по системе.
 *
 * Помощник только читает данные: изменить что-либо через него нельзя.
 * История нужна, чтобы понимать уточнения вроде «а за прошлый месяц?».
 */
export const askAiAssistant = async (
  question: string,
  userId: number,
  history: AiMessage[] = [],
): Promise<AiAnswer> => {
  const res = await fetch(AI_ASSISTANT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, userId, history }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Помощник не ответил');
  return data;
};
