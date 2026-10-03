import type { Role } from '@/lib/roles';
import type { AiMessage, AiUpload } from '@/lib/aiAssistantApi';

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
  /** Текст, извлечённый из вложений — в историю модели на следующих ходах. */
  docExcerpt?: string;
}

const TIMEOUT_HINT =
  'МЕГАМАГ оборвался по таймауту шлюза Поехали (~30 с). Спросите короче или напишите «продолжи».';

const FETCH_HINT =
  'Нет ответа от МЕГАМАГа (обрыв сети или шлюз Поехали). Повторите вопрос; если снова — опубликуйте свежую функцию marketplace_assistant.';

const extractUrl = (line: string) => {
  const m = line.match(/https?:\/\/[^\s]+/);
  return m ? m[0].replace(/[),.]+$/, '') : '';
};

/** Статус «Пошёл смотреть…» из queries бэкенда (search:/read:). */
export const statusFromQueries = (queries: string[] | undefined): string[] => {
  if (!queries?.length) return [];
  const out: string[] = [];
  for (const q of queries) {
    if (q.startsWith('read: ')) {
      const url = q.slice(6).trim();
      if (url) out.push(`Пошёл смотреть информацию: ${url}`);
    } else if (q.startsWith('search: ')) {
      const raw = q.slice(8).trim();
      const url = extractUrl(raw);
      const site = raw.match(/site:(\S+)/i)?.[1];
      const href = url || (site ? `https://${site.replace(/^https?:\/\//, '')}` : '');
      if (href) out.push(`Пошёл смотреть информацию: ${href}`);
    }
  }
  return out;
};

export const askMarketplaceAssistant = async (
  question: string,
  userId: number,
  history: AiMessage[] = [],
  role?: Role,
  files: AiUpload[] = [],
  onStatus?: (text: string) => void,
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
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson, application/json' },
      body: JSON.stringify({
        question,
        userId,
        history: history.map(({ role: r, content, docExcerpt }) => ({
          role: r,
          content:
            r === 'user' && docExcerpt
              ? `${content}\n\n---\nТекст файлов из того сообщения:\n${docExcerpt}`
              : content,
        })),
        role,
        files: files.map(({ name, mime, data }) => ({ name, mime, data })),
        stream: true,
      }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/failed to fetch|networkerror|load failed|aborted/i.test(msg)) {
      throw new Error(FETCH_HINT);
    }
    throw e instanceof Error ? e : new Error(FETCH_HINT);
  }

  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  const raw = await res.text();

  // NDJSON: строки status + финальный done/answer.
  if (ctype.includes('ndjson') || /^\s*\{"type"\s*:/.test(raw)) {
    let answer: ShopAiAnswer | null = null;
    let lastErr = '';
    for (const line of raw.split(/\n+/)) {
      const s = line.trim();
      if (!s) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(s) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (row.type === 'status' && typeof row.text === 'string') {
        onStatus?.(row.text);
      } else if (row.type === 'done' || row.answer) {
        answer = {
          answer: String(row.answer || ''),
          queries: Array.isArray(row.queries) ? (row.queries as string[]) : undefined,
          model: typeof row.model === 'string' ? row.model : undefined,
          docExcerpt: typeof row.docExcerpt === 'string' ? row.docExcerpt : undefined,
        };
        if (typeof row.error === 'string' && row.error) lastErr = row.error;
      } else if (row.type === 'error') {
        lastErr = String(row.error || row.errorMessage || 'МЕГАМАГ не ответил');
      }
    }
    if (!res.ok || (!answer?.answer && lastErr)) {
      if (
        res.status === 504 ||
        res.status === 502 ||
        res.status === 499 ||
        /timeout|499|503/i.test(lastErr)
      ) {
        throw new Error(TIMEOUT_HINT);
      }
      throw new Error(lastErr || `МЕГАМАГ не ответил (${res.status})`);
    }
    if (!answer?.answer) throw new Error(lastErr || 'МЕГАМАГ не ответил');
    for (const st of statusFromQueries(answer.queries)) onStatus?.(st);
    return answer;
  }

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
  const parsed = data as unknown as ShopAiAnswer;
  for (const st of statusFromQueries(parsed.queries)) onStatus?.(st);
  return parsed;
};
