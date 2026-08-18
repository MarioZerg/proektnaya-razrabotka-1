export const money = (v: number | null | undefined) =>
  v == null
    ? '—'
    : v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Короткий формат для таблиц: без копеек, чтобы цифры не рябили. */
export const moneyShort = (v: number | null | undefined) =>
  v == null ? '—' : Math.round(v).toLocaleString('ru-RU');

/** Цвет прибыли: убыток — красный, тонкая маржа — жёлтый, хорошая — зелёный. */
export const profitColor = (margin: number) => {
  if (margin < 0) return 'text-destructive';
  if (margin < 10) return 'text-amber-600';
  return 'text-emerald-600';
};

export const profitBg = (margin: number) => {
  if (margin < 0) return 'border-destructive/40 bg-destructive/5';
  if (margin < 10) return 'border-amber-300 bg-amber-50/50';
  return 'border-emerald-300 bg-emerald-50/40';
};
