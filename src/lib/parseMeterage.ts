/**
 * Разбор метража с бирки рулона по тексту OCR.
 *
 * На бирке поставщика обычно «63,3» или «61.15 м». Камера читает криво:
 * теряет точку, путает запятую, видит «633» вместо «63,3». Здесь из каши
 * цифр достаём длину одного рулона — ту, что кладовщик вбивает в приёмку.
 */

const MIN_M = 5;
const MAX_M = 250;
/** Самый частый диапазон тюлевого рулона — его предпочитаем при нескольких цифрах. */
const TYPICAL_MIN = 20;
const TYPICAL_MAX = 120;

const toNum = (raw: string) => {
  const n = Number(String(raw).replace(',', '.').trim());
  return Number.isFinite(n) ? n : NaN;
};

const inRange = (n: number) => n >= MIN_M && n <= MAX_M;

/** Потерянная точка: 633 → 63.3, 6113 → 61.13. */
const restoreDot = (digits: string): number | null => {
  if (!/^\d{3,5}$/.test(digits)) return null;
  for (const cut of [1, 2]) {
    if (digits.length - cut < 1 || digits.length - cut > 2) continue;
    const n = toNum(`${digits.slice(0, digits.length - cut)}.${digits.slice(-cut)}`);
    if (inRange(n)) return n;
  }
  return null;
};

const score = (n: number, fromLabel: boolean) => {
  let s = 0;
  if (fromLabel) s += 4;
  if (n >= TYPICAL_MIN && n <= TYPICAL_MAX) s += 3;
  if (!Number.isInteger(n)) s += 2;
  return s;
};

/**
 * Возвращает метраж одного рулона или null, если на кадре цифр нет.
 */
export const parseMeterageFromOcr = (text: string): number | null => {
  if (!text.trim()) return null;
  const cleaned = text
    .replace(/[oOоО]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/[зЗ]/g, '3');

  const candidates: { n: number; score: number }[] = [];
  const push = (n: number, fromLabel: boolean) => {
    const rounded = Math.round(n * 1000) / 1000;
    if (!inRange(rounded)) return;
    candidates.push({ n: rounded, score: score(rounded, fromLabel) });
  };

  const labeled = cleaned.matchAll(
    /(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:м|m|п\.?\s*м|пог)/gi,
  );
  for (const m of labeled) {
    const n = toNum(m[1]);
    if (Number.isFinite(n)) push(n, true);
  }

  const decimals = cleaned.matchAll(/\d{1,3}[.,]\d{1,3}/g);
  for (const m of decimals) {
    const n = toNum(m[0]);
    if (Number.isFinite(n)) push(n, false);
  }

  const ints = cleaned.matchAll(/\b\d{2,5}\b/g);
  for (const m of ints) {
    const raw = m[0];
    const asInt = toNum(raw);
    if (inRange(asInt)) push(asInt, false);
    const restored = restoreDot(raw);
    if (restored != null) push(restored, false);
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score || Math.abs(a.n - 60) - Math.abs(b.n - 60));
  return candidates[0].n;
};

export const formatMeterage = (n: number) => String(n);
