/**
 * Журнал вопросов МЕГАБУХу на этом компьютере.
 *
 * Долгая память агента лежит в git: backend/ai_assistant/business_memory.jsonl
 * (её читает только функция, в кабинете файла нет). Сюда пишем, чем чаще
 * спрашивают — чтобы агент видел живую частоту, пока запись не вшили в git.
 */

const keyOf = (userId: number) => `ai-assistant-practice:v1:${userId}`;
const MAX = 80;

export type PracticeDigest = {
  total: number;
  top: { q: string; n: number }[];
  recent: string[];
};

const norm = (q: string) => q.trim().replace(/\s+/g, ' ').slice(0, 160);

type Hit = { q: string; n: number; last: number };

const readHits = (userId: number): Hit[] => {
  try {
    const raw = localStorage.getItem(keyOf(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((h) => h && typeof h.q === 'string' && typeof h.n === 'number');
  } catch {
    return [];
  }
};

/** Запомнить вопрос после ответа агента. Очистку чата не трогает. */
export const recordMegabuhPractice = (userId: number, question: string) => {
  const q = norm(question);
  if (!q || q.length < 4) return;
  const now = Date.now();
  const hits = readHits(userId);
  const i = hits.findIndex((h) => h.q.toLowerCase() === q.toLowerCase());
  if (i >= 0) {
    hits[i] = { q: hits[i].q, n: hits[i].n + 1, last: now };
  } else {
    hits.push({ q, n: 1, last: now });
  }
  hits.sort((a, b) => b.n - a.n || b.last - a.last);
  try {
    localStorage.setItem(keyOf(userId), JSON.stringify(hits.slice(0, MAX)));
  } catch {
    /* ignore */
  }
};

/** Короткий срез для модели: чем чаще занимаемся, что спрашивали недавно. */
export const megabuhPracticeDigest = (userId: number): PracticeDigest => {
  const hits = readHits(userId);
  const top = [...hits].sort((a, b) => b.n - a.n).slice(0, 12).map(({ q, n }) => ({ q, n }));
  const recent = [...hits].sort((a, b) => b.last - a.last).slice(0, 8).map((h) => h.q);
  const total = hits.reduce((s, h) => s + h.n, 0);
  return { total, top, recent };
};
