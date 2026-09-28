/**
 * Метраж с бирки: только сетка от 20 до 200 м с шагом 0,1 —
 * 20, 20.1, 20.2, … 199.9, 200. Любое другое число OCR отбрасываем.
 */

const MIN_TENTHS = 200;
const MAX_TENTHS = 2000;
const TYPICAL_MAX = 170;

/** Все допустимые длины в десятых долях метра: 200 → 20.0, 201 → 20.1, … 2000 → 200.0 */
const ALLOWED_TENTHS = new Set<number>();
for (let t = MIN_TENTHS; t <= MAX_TENTHS; t += 1) {
  ALLOWED_TENTHS.add(t);
}

type Cand = { n: number; score: number };

const roundM = (n: number) => Math.round(n * 100) / 100;

const toNum = (raw: string) => {
  const n = Number(String(raw).replace(',', '.').trim());
  return Number.isFinite(n) ? n : NaN;
};

/** Только значение из сетки 20 / 20.1 / 20.2 / … / 200, иначе null. */
const toAllowed = (n: number): number | null => {
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  if (cents % 10 !== 0) return null;
  const tenths = cents / 10;
  if (!ALLOWED_TENTHS.has(tenths)) return null;
  return tenths / 10;
};

const score = (n: number, fromLabel: boolean) => {
  let s = 0;
  if (fromLabel) s += 8;
  if (n <= TYPICAL_MAX) s += 3;
  if (!Number.isInteger(n)) s += 2;
  return s;
};

const bestUnique = (candidates: Cand[]): number | null => {
  if (candidates.length === 0) return null;
  const best = new Map<number, number>();
  for (const c of candidates) {
    const prev = best.get(c.n) ?? -Infinity;
    if (c.score > prev) best.set(c.n, c.score);
  }
  const list = [...best.entries()].map(([n, s]) => ({ n, score: s }));
  list.sort((a, b) => b.score - a.score || Math.abs(a.n - 80) - Math.abs(b.n - 80));
  const top = list[0];
  const rival = list.find((c) => c.n !== top.n && c.score >= top.score - 1);
  if (rival) return null;
  return top.n;
};

/**
 * Ноль с косой OCR даёт 9. Подставляем 0, только если результат есть в сетке.
 * 90 и 96.3 остаются: «00» / «06.3» в сетке нет.
 */
const slashedZeroFromNine = (n: number): number => {
  const rounded = roundM(n);
  const asText = String(rounded);
  if (!asText.includes('9')) return rounded;
  const alt = toAllowed(Number(asText.replace(/9/g, '0')));
  return alt ?? rounded;
};

const push = (list: Cand[], n: number, fromLabel: boolean) => {
  const rounded = slashedZeroFromNine(n);
  let allowed = toAllowed(rounded);
  if (allowed == null && !Number.isInteger(rounded) && rounded > TYPICAL_MAX && rounded < 200) {
    allowed = toAllowed(rounded - 100);
  }
  if (allowed == null) return;
  list.push({ n: allowed, score: score(allowed, fromLabel) });
};

const cleanOcr = (text: string) =>
  text
    .replace(/[oOоОøØ∅⌀]/g, '0')
    .replace(/[зЗ]/g, '3')
    .replace(/[，‚،]/g, ',')
    .replace(/[·∙•‧''′`´]/g, '.')
    .replace(/(\d{2,3})[lI|\/\\](\d{1,2})(?!\d)/g, '$1.$2')
    .replace(/(^|[^\d])1([3-9]\d[.,]\d{1,2})(?!\d)/g, '$1$2')
    .replace(/\d{1,2}[.,/\-]\d{1,2}[.,/\-]\d{2,4}/g, ' ')
    .replace(/\d{5,}/g, ' ')
    .replace(/(\d{2,3})[^\d]{1,3}(\d{1,2})(?!\d)/g, '$1.$2');

/**
 * Потерянная запятая: «863» → 86.3, если 86.3 в сетке.
 * «120» и «200» уже в сетке — не превращаем в 12.0.
 */
const restoreLostDot = (digits: string): number | null => {
  if (!/^\d{3,4}$/.test(digits)) return null;
  const raw = Number(digits);
  if (raw >= 2020 && raw <= 2039) return null;
  if (digits.length === 3) {
    if (toAllowed(raw) != null) return null;
    return toAllowed(raw / 10);
  }
  const hundredths = toAllowed(raw / 100);
  const tenths = toAllowed(raw / 10);
  if (hundredths != null && tenths != null && hundredths !== tenths) return null;
  return hundredths ?? tenths;
};

export const parseMeterageFromOcr = (text: string): number | null => {
  if (!text.trim()) return null;
  const cleaned = cleanOcr(text);

  const labeled: Cand[] = [];
  for (const m of cleaned.matchAll(/(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:пог\.?|п\.?\s*м|[мm])(?!\d)/gi)) {
    const n = toNum(m[1]);
    if (Number.isFinite(n)) push(labeled, n, true);
  }
  const fromLabel = bestUnique(labeled);
  if (fromLabel != null) return fromLabel;

  const decimals: Cand[] = [];
  for (const m of cleaned.matchAll(/\d{2,3}[.,]\d{1,2}/g)) {
    const n = toNum(m[0]);
    if (Number.isFinite(n)) push(decimals, n, false);
  }
  const fromDecimal = bestUnique(decimals);
  if (fromDecimal != null) return fromDecimal;

  const digitRuns = cleaned.match(/\d+/g) || [];
  if (digitRuns.length === 1 && (digitRuns[0].length === 3 || digitRuns[0].length === 4)) {
    const restored = restoreLostDot(digitRuns[0]);
    if (restored != null) return toAllowed(slashedZeroFromNine(restored));
  }

  const withoutDecimals = cleaned.replace(/\d{2,3}[.,]\d{1,2}/g, ' ');
  const intTokens = [...withoutDecimals.matchAll(/\d{2,3}/g)].map((m) => m[0]);
  const ints = intTokens.map(toNum).filter((n) => Number.isFinite(n));
  const uniqAllowed = [...new Set(ints.map(toAllowed).filter((n): n is number => n != null))];

  if (uniqAllowed.length === 1) {
    const otherTokens = intTokens.filter((t) => toAllowed(toNum(t)) !== uniqAllowed[0]);
    if (otherTokens.length === 0) {
      const v = toAllowed(slashedZeroFromNine(uniqAllowed[0]));
      return v;
    }
    if (otherTokens.length === 1) {
      const fracToken = otherTokens[0];
      const frac = toNum(fracToken);
      if (frac > 0 && frac <= 99) {
        const combined = uniqAllowed[0] + frac / (fracToken.length >= 2 ? 100 : 10);
        return toAllowed(slashedZeroFromNine(combined));
      }
    }
  }

  if (intTokens.length === 2) {
    const whole = toNum(intTokens[0]);
    const fracToken = intTokens[1];
    const frac = toNum(fracToken);
    if (toAllowed(whole) != null && frac >= 0 && frac <= 99) {
      const combined = whole + frac / (fracToken.length >= 2 ? 100 : 10);
      const v = toAllowed(slashedZeroFromNine(combined));
      if (v != null && v !== toAllowed(whole)) return v;
    }
  }

  return null;
};

export const formatMeterage = (n: number) => {
  const allowed = toAllowed(n);
  return String(allowed ?? roundM(n));
};
