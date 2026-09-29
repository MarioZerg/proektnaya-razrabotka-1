import { formatAccrualShift } from '@/components/crm/finance/financeShared';

/** Начисление, из которого собирается дневная плашка. */
export type DayAccrual = {
  id: number;
  type: string;
  amount: number;
  description: string;
  orderNumber: string | null;
  accruedFor: string;
  paidAt?: string | null;
  shiftWorkshopName?: string | null;
  shiftNumber?: number | null;
  shiftOpenedAt?: string | null;
};

/** Строка заказа внутри отработанного дня. */
export type DayOrderRow = {
  id: number;
  orderNumber: string | null;
  type: string;
  description: string;
  amount: number;
  meters: number | null;
  paidAt: string | null;
};

export type DayExtraRow = {
  id: number;
  type: string;
  description: string;
  amount: number;
  paidAt: string | null;
};

export type WorkedDay = {
  date: string;
  shiftLabel: string;
  orders: DayOrderRow[];
  salaries: DayExtraRow[];
  bonuses: DayExtraRow[];
  deductions: DayExtraRow[];
  metersTotal: number;
  earned: number;
  deductionsTotal: number;
  net: number;
};

const ORDER_TYPES = new Set([
  'cutter_cut',
  'sewer_piece',
  'overlock_piece',
  'packer_stickering',
  'packer_repack',
]);

const SALARY_TYPES = new Set([
  'storekeeper_shift',
  'senior_storekeeper_shift',
  'cleaner_shift',
  'admin_daily',
]);

const DEDUCTION_TYPES = new Set(['penalty', 'deduction']);

const BONUS_TYPES = new Set(['bonus', 'penalty_refund']);

const METERS_RE = /(\d+(?:[.,]\d+)?)\s*(?:пог\.?\s*м\.?|п\.?\s*м\.?)/i;
const CM_RE = /\((\d+)\s*см\)/;

/** Метраж из текста начисления: «2.4 пог.м.» или «(300 см)». */
export const parseMeters = (description: string): number | null => {
  const meters = description.match(METERS_RE);
  if (meters) {
    const n = Number(meters[1].replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  const cm = description.match(CM_RE);
  if (cm) {
    const n = Number(cm[1]) / 100;
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const extraRow = (a: DayAccrual): DayExtraRow => ({
  id: a.id,
  type: a.type,
  description: a.description,
  amount: a.amount,
  paidAt: a.paidAt ?? null,
});

const emptyDay = (date: string): WorkedDay => ({
  date,
  shiftLabel: '',
  orders: [],
  salaries: [],
  bonuses: [],
  deductions: [],
  metersTotal: 0,
  earned: 0,
  deductionsTotal: 0,
  net: 0,
});

const finishDay = (day: WorkedDay): WorkedDay => {
  const metersTotal = day.orders.reduce((s, r) => s + (r.meters || 0), 0);
  const earned =
    day.orders.reduce((s, r) => s + r.amount, 0) +
    day.salaries.reduce((s, r) => s + r.amount, 0) +
    day.bonuses.reduce((s, r) => s + r.amount, 0);
  const deductionsTotal = day.deductions.reduce((s, r) => s + r.amount, 0);
  return {
    ...day,
    metersTotal,
    earned,
    deductionsTotal,
    net: earned + deductionsTotal,
  };
};

/**
 * Собирает начисления в плашки по дню: заказы строками, вычеты и надбавки
 * отдельно, внизу метраж и итог. Одна плашка на календарный день, а не на заказ.
 */
export const groupAccrualsByDay = (accruals: DayAccrual[]): WorkedDay[] => {
  const byDate = new Map<string, WorkedDay>();

  for (const a of accruals) {
    const date = a.accruedFor.slice(0, 10);
    let day = byDate.get(date);
    if (!day) {
      day = emptyDay(date);
      byDate.set(date, day);
    }
    if (!day.shiftLabel) {
      day.shiftLabel = formatAccrualShift(a);
    }

    if (ORDER_TYPES.has(a.type)) {
      day.orders.push({
        id: a.id,
        orderNumber: a.orderNumber,
        type: a.type,
        description: a.description,
        amount: a.amount,
        meters: parseMeters(a.description),
        paidAt: a.paidAt ?? null,
      });
      continue;
    }
    if (SALARY_TYPES.has(a.type)) {
      day.salaries.push(extraRow(a));
      continue;
    }
    if (DEDUCTION_TYPES.has(a.type) || a.amount < 0) {
      day.deductions.push(extraRow(a));
      continue;
    }
    if (BONUS_TYPES.has(a.type) || a.type === 'manual') {
      day.bonuses.push(extraRow(a));
      continue;
    }
    day.bonuses.push(extraRow(a));
  }

  return [...byDate.values()]
    .map((day) => {
      day.orders.sort((a, b) => (a.orderNumber || '').localeCompare(b.orderNumber || '', 'ru'));
      return finishDay(day);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
};

export const formatMeters = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
