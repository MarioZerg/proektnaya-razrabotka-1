import { Input } from '@/components/ui/input';
import type { View } from '@/components/crm/siteProducts/siteProductsShared';

interface Props {
  views: { value: View; label: string; count: number }[];
  view: View;
  onView: (v: View) => void;
  product: string;
  onProduct: (v: string) => void;
  productOptions: [string, string][];
  query: string;
  onQuery: (v: string) => void;
}

/** Фильтры вкладки: виды, карточка, поиск. */
const SiteProductsFilters = ({
  views,
  view,
  onView,
  product,
  onProduct,
  productOptions,
  query,
  onQuery,
}: Props) => (
  <div className="flex flex-wrap items-center gap-2">
    {views.map((v) => (
      <button
        key={v.value}
        type="button"
        onClick={() => onView(v.value)}
        className={`rounded-full border px-3 py-1 text-sm transition ${
          view === v.value
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-background text-foreground hover:bg-muted'
        }`}
      >
        {v.label}
        <span className="ml-1.5 text-xs opacity-70">{v.count}</span>
      </button>
    ))}
    <select
      value={product}
      onChange={(e) => onProduct(e.target.value)}
      className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
    >
      <option value="all">Все карточки</option>
      {productOptions.map(([id, name]) => (
        <option key={id} value={id}>
          {name || id}
        </option>
      ))}
    </select>
    <Input
      placeholder="Артикул или название"
      value={query}
      onChange={(e) => onQuery(e.target.value)}
      className="h-8 w-full sm:w-56"
    />
  </div>
);

export default SiteProductsFilters;
