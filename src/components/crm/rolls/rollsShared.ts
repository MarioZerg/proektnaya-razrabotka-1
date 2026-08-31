import type { RollStatus } from '@/lib/rollsApi';

export const statusLabels: Record<
  RollStatus,
  { label: string; variant: 'secondary' | 'default' | 'outline' }
> = {
  in_storage: { label: 'На складе', variant: 'secondary' },
  in_workshop: { label: 'В цехе', variant: 'default' },
  completed: { label: 'Завершён', variant: 'outline' },
};

/** Подпись статуса с запасным вариантом.
 *
 * Раньше обращались к словарю напрямую, и один неизвестный статус (такие приходят
 * при переносе данных из другой системы) ронял всю страницу с ошибкой. Теперь
 * незнакомое значение показывается как есть, а список остаётся рабочим. */
export const rollStatusLabel = (status: string) =>
  statusLabels[status as RollStatus] || { label: status, variant: 'outline' as const };

/** Ниже этого остатка (в погонных метрах) рулон считается заканчивающимся. */
export const ROLL_LOW_STOCK_THRESHOLD = 20;

/**
 * Единицы, которые метрами НЕ являются. Штуки, килограммы и упаковки меряются
 * иначе: «меньше 20 штук» — это нормальный остаток, а не тревога.
 */
const NOT_METERS_PREFIXES = ['шт', 'кг', 'г', 'уп', 'компл'];

/** Рулон меряется в погонных метрах? Пустая единица по правилам системы — метры. */
export const isMetersUnit = (unit?: string | null) => {
  // Пробелы убираем все: в базе встречается и «пог. м», и «пог.м».
  const v = (unit || '').toLowerCase().replace(/\s/g, '');
  return !NOT_METERS_PREFIXES.some((p) => v.startsWith(p));
};

/**
 * Рулон заканчивается: осталось меньше 20 погонных метров, и он В ЦЕХЕ.
 *
 * Складские рулоны сюда не относятся — там небольшой остаток это запас, а не
 * проблема. Тревога именно про цех: закройщику вот-вот будет не из чего кроить.
 * Правило повторяет расчёт счётчика на главной, чтобы цифра в виджете и список
 * на странице всегда сходились.
 */
export const isLowStockRoll = (roll: {
  status: string;
  unit?: string | null;
  remainingQuantity: number;
}) =>
  roll.status === 'in_workshop' &&
  isMetersUnit(roll.unit) &&
  roll.remainingQuantity < ROLL_LOW_STOCK_THRESHOLD;