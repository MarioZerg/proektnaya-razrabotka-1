import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { SiteWidthGroup } from '@/components/crm/siteProducts/siteWidthGroups';
import { rub } from '@/components/crm/siteProducts/siteProductsShared';

interface Props {
  title: string;
  groups: SiteWidthGroup[];
  matOpen: boolean;
  matDisabled: boolean;
  lowProfit: SiteWidthGroup[];
  priceOf: (g: SiteWidthGroup) => number | null;
  canToggle: boolean;
  toggling: string | null;
  onToggleOpen: (title: string) => void;
  onToggleDisabled: (title: string) => void;
}

/** Строка ткани: сводка по её ширинам и включение/выключение всей ткани. */
const SiteMaterialRow = ({
  title,
  groups,
  matOpen,
  matDisabled,
  lowProfit,
  priceOf,
  canToggle,
  toggling,
  onToggleOpen,
  onToggleDisabled,
}: Props) => {
  const ws = groups.map((g) => g.width).filter((w): w is number => w != null);
  const costs = groups.map((g) => g.cost).filter((c): c is number => c != null);
  const prices = groups.map(priceOf).filter((c): c is number => c != null);
  const range = (v: number[]) =>
    v.length === 0
      ? '—'
      : Math.min(...v) === Math.max(...v)
        ? rub(v[0])
        : `${rub(Math.min(...v))} – ${rub(Math.max(...v))}`;
  const issues = [
    groups.filter((g) => g.noMaterials > 0).length && `без расхода ${groups.filter((g) => g.noMaterials > 0).length}`,
    groups.filter((g) => g.price == null || g.price === 'mixed').length &&
      `без цены ${groups.filter((g) => g.price == null || g.price === 'mixed').length}`,
    groups.filter((g) => lowProfit.includes(g)).length &&
      `ниже цели ${groups.filter((g) => lowProfit.includes(g)).length}`,
    groups.filter((g) => g.disabled).length && `выкл ${groups.filter((g) => g.disabled).length}`,
  ].filter(Boolean);

  return (
    <tr
      className="cursor-pointer border-t-2 border-border bg-muted/40 hover:bg-muted/60"
      onClick={() => onToggleOpen(title)}
    >
      <td className="px-3 py-2.5" colSpan={2}>
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <Icon name={matOpen ? 'ChevronDown' : 'ChevronRight'} size={16} />
          {title}
        </span>
      </td>
      <td className="px-3 py-2.5 text-muted-foreground">
        {groups.length} шир.{ws.length > 0 && ` · ${Math.min(...ws)}–${Math.max(...ws)}`}
      </td>
      <td className="px-3 py-2.5" colSpan={2}>
        <span className="text-muted-foreground">себест. </span>
        {range(costs)}
      </td>
      <td className="px-3 py-2.5">{range(prices)}</td>
      <td className="px-3 py-2.5">
        {issues.length ? (
          <span className="text-xs text-amber-700">{issues.join(' · ')}</span>
        ) : (
          <span className="text-xs text-emerald-700">всё заполнено</span>
        )}
      </td>
      <td className="px-3 py-2.5" colSpan={2} onClick={(e) => e.stopPropagation()}>
        {canToggle ? (
          <Button
            size="sm"
            variant={matDisabled ? 'default' : 'outline'}
            disabled={toggling === `mat:${title}`}
            onClick={() => onToggleDisabled(title)}
          >
            {toggling === `mat:${title}` ? (
              <Icon name="Loader2" size={14} className="animate-spin" />
            ) : matDisabled ? (
              'Включить ткань'
            ) : (
              'Выключить ткань'
            )}
          </Button>
        ) : matDisabled ? (
          <span className="text-xs text-amber-700">выключена</span>
        ) : null}
      </td>
    </tr>
  );
};

export default SiteMaterialRow;
