/**
 * Метраж с бирки поставщика в зоне сканера.
 *
 * У нас рулоны от 20 до 200 м, в том числе ровные целые: «40», «50», «120», «200».
 * С десятичными: «86,3», «113.5», «120.8», «20.03», «20.10» — как на стикере.
 * Дату, год, штрихкод и куски артикула не подставляем.
 */

const MIN_M = 20;
const MAX_M = 200;
const TYPICAL_MAX = 170;

type Cand = { n: number; score: number };

const roundM = (n: number) => Math.round(n * 100) / 100;

const isMeterage = (n: number) => Number.isFinite(n) && n >= MIN_M && n <= MAX_M;

const toNum = (raw: string) => {
  const n = Number(String(raw).replace(',', '.').trim());
  return Number.isFinite(n) ? n : NaN;
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

const push = (list: Cand[], n: number, fromLabel: boolean) => {
  const rounded = roundM(n);
  if (!isMeterage(rounded)) return;
  list.push({ n: rounded, score: score(rounded, fromLabel) });
};

const cleanOcr = (text: string) =>
  text
    .replace(/[oOоО]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/[зЗ]/g, '3')
    .replace(/[，‚،]/g, ',')
    .replace(/[·∙•‧''′`´]/g, '.')
    .replace(/\d{1,2}[.,/\-]\d{1,2}[.,/\-]\d{2,4}/g, ' ')
    .replace(/\d{5,}/g, ' ')
    // «50m8» / «50 80»: OCR подменил запятую буквой или пробелом
    .replace(/(\d{2,3})[^\d]{1,3}(\d{1,2})(?!\d)/g, '$1.$2');

/**
 * Если OCR потерял запятую: «863» это 86.3, а не 863 м (таких рулонов нет).
 * «120» и «200» уже нормальная длина — оставляем как есть, не делаем из них 12.0.
 * Годы 2020–2039 не считаем метражом.
 */
const restoreLostDot = (digits: string): number | null => {
  if (!/^\d{3,4}$/.test(digits)) return null;
  const raw = Number(digits);
  if (raw >= 2020 && raw <= 2039) return null;
  if (digits.length === 3) {
    if (isMeterage(raw)) return null;
    const tenths = roundM(raw / 10);
    return isMeterage(tenths) ? tenths : null;
  }
  const hundredths = roundM(raw / 100);
  const tenths = roundM(raw / 10);
  const a = isMeterage(hundredths) ? hundredths : null;
  const b = isMeterage(tenths) ? tenths : null;
  if (a != null && b != null && a !== b) return null;
  return a ?? b;
};

/**
 * Возвращает метраж одного рулона или null, если в зоне нет одной явной длины.
 */
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
    if (restored != null) return restored;
  }

  const withoutDecimals = cleaned.replace(/\d{2,3}[.,]\d{1,2}/g, ' ');
  const intTokens = [...withoutDecimals.matchAll(/\d{1,3}/g)].map((m) => m[0]);
  const ints = intTokens.map(toNum).filter((n) => Number.isFinite(n));
  const uniqInts = [...new Set(ints.filter(isMeterage).map(roundM))];

  if (uniqInts.length === 1) {
    const otherTokens = intTokens.filter((t) => toNum(t) !== uniqInts[0]);
    if (otherTokens.length === 0) return uniqInts[0];
    if (otherTokens.length === 1) {
      const fracToken = otherTokens[0];
      const frac = toNum(fracToken);
      if (frac > 0 && frac <= 99) {
        const combined = roundM(uniqInts[0] + frac / (fracToken.length >= 2 ? 100 : 10));
        if (isMeterage(combined)) return combined;
      }
    }
  }

  if (intTokens.length === 2) {
    const whole = toNum(intTokens[0]);
    const fracToken = intTokens[1];
    const frac = toNum(fracToken);
    if (isMeterage(whole) && frac >= 0 && frac <= 99) {
      const combined = roundM(whole + frac / (fracToken.length >= 2 ? 100 : 10));
      if (isMeterage(combined) && combined !== whole) return combined;
    }
  }

  return null;
};

export const formatMeterage = (n: number) => String(roundM(n));
