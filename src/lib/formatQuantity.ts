/** Форматирует количество материала (метры, остатки рулонов и т.д.) максимум до сотых —
 * в БД такие поля хранятся с 3 знаками после запятой (NUMERIC(x,3)), но отображать нужно
 * не больше 2, например 7.05 вместо 7.050. Лишние нули после запятой не показывает. */
export function formatQuantity(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === '') return '0';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (Number.isNaN(num)) return '0';
  return Number(num.toFixed(2)).toString();
}
