import { Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { SitePricing } from '@/lib/siteOrdersApi';
import { recommendedPrice, siteProfit } from '@/lib/sitePricing';
import SiteProfitCell from '@/components/crm/siteProducts/SiteProfitCell';
import SiteProfitChain from '@/components/crm/siteProducts/SiteProfitChain';
import SitePriceCell from '@/components/crm/siteProducts/SitePriceCell';
import SiteHeightPriceCell from '@/components/crm/siteProducts/SiteHeightPriceCell';
import type { SiteWidthGroup } from '@/components/crm/siteProducts/siteWidthGroups';
import { rub, type SiteActor } from '@/components/crm/siteProducts/siteProductsShared';

interface Props {
  g: SiteWidthGroup;
  isOpen: boolean;
  pricing: SitePricing;
  isAdmin: boolean;
  actor: SiteActor;
  toggling: string | null;
  priceOf: (g: SiteWidthGroup) => number | null;
  targetOf: (g: SiteWidthGroup) => number | null;
  onToggleOpen: (key: string) => void;
  onToggleDisabled: (g: SiteWidthGroup) => void;
  onEdit: (g: SiteWidthGroup) => void;
  onSaved: () => void;
}

/** Строка одной ширины ткани и раскрывающийся список её высот. */
const SiteWidthRow = ({
  g,
  isOpen,
  pricing,
  isAdmin,
  actor,
  toggling,
  priceOf,
  targetOf,
  onToggleOpen,
  onToggleDisabled,
  onEdit,
  onSaved,
}: Props) => (
  <Fragment>
    <tr className={`border-t border-border align-top ${g.disabled ? 'bg-muted/40' : ''}`}>
      <td className="px-3 py-2 pl-9">
        <span className="text-muted-foreground">{g.title}</span>
        {g.archived && (
          <Badge variant="outline" className="ml-2 border-amber-300 bg-amber-50 text-amber-800">
            архив
          </Badge>
        )}
        {g.manual && (
          <Badge variant="outline" className="ml-2">
            вручную
          </Badge>
        )}
      </td>
      <td className="px-3 py-2 font-semibold">{g.width ? `${g.width} см` : '—'}</td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => onToggleOpen(g.key)}
          className="inline-flex items-center gap-1 text-sky-700 hover:underline"
        >
          <Icon name={isOpen ? 'ChevronUp' : 'ChevronDown'} size={14} />
          {g.items.length} шт
          {g.heights.length > 0 && ` · ${Math.min(...g.heights)}–${Math.max(...g.heights)}`}
        </button>
      </td>
      <td className="px-3 py-2">
        {g.noMaterials === 0 ? (
          <span className="text-emerald-700">материалов: {g.materialsCount}</span>
        ) : g.noMaterials === g.items.length ? (
          <span className="text-amber-700">не проставлен</span>
        ) : (
          <span className="text-amber-700">нет у {g.noMaterials} высот</span>
        )}
      </td>
      <td className="px-3 py-2">
        {g.cost != null ? rub(g.cost) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2">
        <SitePriceCell
          group={g}
          pricing={pricing}
          canEdit={isAdmin && !g.archived}
          actor={actor}
          onSaved={onSaved}
        />
      </td>
      <td className="px-3 py-2">
        <SiteProfitCell item={{ price: priceOf(g), cost: g.cost }} pricing={pricing} target={targetOf(g)} />
        <SiteProfitChain group={g} pricing={pricing} />
      </td>
      <td className="px-3 py-2">
        {isAdmin && !g.archived ? (
          <Button
            size="sm"
            variant={g.disabled ? 'default' : 'outline'}
            disabled={toggling === g.key}
            onClick={() => onToggleDisabled(g)}
          >
            {g.disabled ? 'Включить' : 'Выключить'}
          </Button>
        ) : g.disabled ? (
          <span className="text-amber-700">выключена</span>
        ) : (
          <span className="text-emerald-700">продаётся</span>
        )}
        {g.partlyDisabled && <p className="mt-0.5 text-xs text-amber-700">часть высот выключена</p>}
      </td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" variant="outline" onClick={() => onEdit(g)}>
          <Icon name="Pencil" size={14} className="mr-1" />
          Расход
        </Button>
      </td>
    </tr>
    {isOpen && (
      <tr className="border-t border-border/50 bg-muted/20">
        <td colSpan={9} className="px-3 py-2">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">Высота</th>
                <th className="py-1 pr-3 font-medium">Наш артикул</th>
                <th className="py-1 pr-3 font-medium">Артикул сайта</th>
                <th className="py-1 pr-3 font-medium">Себестоимость</th>
                <th className="py-1 pr-3 font-medium">Цена</th>
                <th className="py-1 pr-3 font-medium">Прибыль с блогером</th>
                <th className="py-1 pr-3 font-medium">Без блогера</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((i) => {
                const target = targetOf(g);
                const withB = i.price != null && i.cost != null ? siteProfit(i.price, i.cost, pricing, true) : null;
                const noB = i.price != null && i.cost != null ? siteProfit(i.price, i.cost, pricing) : null;
                return (
                  <tr key={i.id} className={`border-t border-border/40 ${i.disabled ? 'opacity-50' : ''}`}>
                    <td className="py-1 pr-3 font-semibold">{i.height ?? '—'}</td>
                    <td className="py-1 pr-3 font-mono font-semibold">{i.internalSku || '—'}</td>
                    <td className="py-1 pr-3 font-mono text-muted-foreground">{i.article}</td>
                    <td className="py-1 pr-3">
                      {i.cost != null ? rub(i.cost) : <span className="text-amber-700">нет расхода</span>}
                    </td>
                    <td className="py-1 pr-3">
                      <SiteHeightPriceCell
                        item={i}
                        recommended={i.cost != null ? recommendedPrice(i.cost, g.width, pricing) : null}
                        canEdit={isAdmin && !i.archivedAt}
                        actor={actor}
                        onSaved={onSaved}
                      />
                    </td>
                    <td
                      className={`py-1 pr-3 font-medium ${
                        !withB
                          ? ''
                          : withB.profit < 0
                            ? 'text-red-600'
                            : target != null && withB.profit < target - 5
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                      }`}
                    >
                      {withB ? `${rub(withB.profit)} · ${Math.round(withB.profitPct)}%` : '—'}
                    </td>
                    <td className="py-1 pr-3 text-muted-foreground">
                      {noB ? rub(noB.profit) : '—'}
                      {i.disabled ? ' · выкл' : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </td>
      </tr>
    )}
  </Fragment>
);

export default SiteWidthRow;
