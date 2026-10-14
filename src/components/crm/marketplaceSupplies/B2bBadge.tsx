interface B2bBadgeProps {
  className?: string;
}

/** Метка заказа или поставки юрлица (B2B): WB не смешивает их с обычными. */
const B2bBadge = ({ className = '' }: B2bBadgeProps) => (
  <span
    className={`inline-flex items-center rounded bg-indigo-600 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white ${className}`}
    title="Заказ юридического лица — едет только в поставке B2B"
  >
    B2B
  </span>
);

export default B2bBadge;
