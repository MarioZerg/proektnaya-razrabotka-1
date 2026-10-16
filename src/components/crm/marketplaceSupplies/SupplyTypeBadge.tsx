interface SupplyTypeBadgeProps {
  type: string | null | undefined;
  className?: string;
}

/**
 * Схема поставки — FBS или FBO — крупной цветной меткой.
 *
 * Раньше схема была серым текстом «· FBS» под номером, и в списке её не было
 * видно: кладовщик открывал поставку, чтобы понять, что он собирает.
 */
const SupplyTypeBadge = ({ type, className = '' }: SupplyTypeBadgeProps) => {
  if (!type) return null;
  const color =
    type === 'FBS'
      ? 'bg-orange-500 text-white'
      : type === 'FBO'
        ? 'bg-teal-600 text-white'
        : 'bg-slate-500 text-white';
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-1 text-xs font-bold leading-none tracking-wide ${color} ${className}`}
    >
      {type}
    </span>
  );
};

export default SupplyTypeBadge;
