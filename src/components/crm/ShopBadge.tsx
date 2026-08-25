interface ShopBadgeProps {
  name?: string | null;
  color?: string | null;
  className?: string;
}

/**
 * Метка магазина на заказе: МЕГАТЮЛЬ или ДЮНА.
 *
 * Производство общее — заказы обоих магазинов лежат в одной очереди и идут
 * через тот же раскрой и пошив. Но упаковка, вкладыши и бирки у магазинов
 * разные, поэтому в цехе нужно различать их одним взглядом, не вчитываясь в
 * номер заказа.
 *
 * Пока магазин один, метка не рисуется вовсе: лишний ярлык на каждой строке
 * только зашумляет экран.
 */
const COLORS: Record<string, string> = {
  emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  sky: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const ShopBadge = ({ name, color, className = '' }: ShopBadgeProps) => {
  if (!name) return null;
  const tone = COLORS[color || 'slate'] || COLORS.slate;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide ${tone} ${className}`}
    >
      {name}
    </span>
  );
};

export default ShopBadge;
