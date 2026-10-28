import { Fragment, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import {
  fetchSiteCatalog,
  setSiteDisabled,
  syncSiteProducts,
  type SiteCatalogItem,
  type SitePricing,
} from '@/lib/siteOrdersApi';
import SitePricingPanel from '@/components/crm/siteProducts/SitePricingPanel';
import SiteProfitCell from '@/components/crm/siteProducts/SiteProfitCell';
import { siteProfit, targetProfit, type CostRange } from '@/lib/sitePricing';
import SitePriceCell from '@/components/crm/siteProducts/SitePriceCell';
import SiteItemMaterialsDialog from '@/components/crm/siteProducts/SiteItemMaterialsDialog';
import { groupByWidth, type SiteWidthGroup } from '@/components/crm/siteProducts/siteWidthGroups';

type View = 'active' | 'noMaterials' | 'noPrice' | 'lowProfit' | 'disabled' | 'archived';

const DEFAULT_PRICING: SitePricing = {
  minProfitRub: 250,
  maxProfitRub: 450,
  taxPct: 6,
  acquiringPct: 2,
  bloggerPct: 10,
};

const rub = (v: number) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;

/** Товары мегатюль.рф: одна строка — одна ширина карточки, внутри все её высоты. */
const SiteProductsTab = ({ shopId }: { shopId: number }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState<SiteCatalogItem[]>([]);
  const [pricing, setPricing] = useState<SitePricing>(DEFAULT_PRICING);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('active');
  const [product, setProduct] = useState<string>('all');
  const [editing, setEditing] = useState<SiteWidthGroup | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const isAdmin = user?.role === 'admin';
  const actor = { id: user?.id, name: user?.name };

  const load = () => {
    setLoading(true);
    fetchSiteCatalog()
      .then(({ items: list, pricing: p }) => {
        setItems(list);
        if (p) setPricing(p);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    fetchMaterialsData()
      .then((d) => setMaterials(d.materials))
      .catch(() => {});
  }, [shopId]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await syncSiteProducts({ id: user?.id, name: user?.name });
      toast({
        title: 'Товары загружены',
        description:
          `Карточек на сайте: ${r.siteProducts ?? 0}, артикулов: ${r.siteCards ?? 0}. ` +
          `Новых: ${r.created}, обновлено: ${r.updated ?? 0}` +
          (r.archived ? `, в архив: ${r.archived}` : '') +
          (r.restored ? `, из архива: ${r.restored}` : '') +
          '.',
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось загрузить товары',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const allGroups = useMemo(() => groupByWidth(items), [items]);
  const active = allGroups.filter((g) => !g.archived);
  const archived = allGroups.filter((g) => g.archived);
  const noMaterials = active.filter((g) => g.noMaterials > 0);
  const noPrice = active.filter((g) => g.price == null || g.price === 'mixed');
  const disabled = active.filter((g) => g.disabled || g.partlyDisabled);
  const costs = active.map((g) => g.cost).filter((c): c is number => c != null);
  const range: CostRange = {
    min: costs.length ? Math.min(...costs) : 0,
    max: costs.length ? Math.max(...costs) : 0,
  };
  const targetOf = (g: SiteWidthGroup) => (g.cost != null ? targetProfit(g.cost, range, pricing) : null);
  const priceOf = (g: SiteWidthGroup) => (typeof g.price === 'number' ? g.price : null);
  const lowProfit = active.filter((g) => {
    const price = priceOf(g);
    return (
      price != null &&
      g.cost != null &&
      siteProfit(price, g.cost, pricing, true).profit < (targetOf(g) ?? 0) - 5
    );
  });

  const toggleDisabled = async (g: SiteWidthGroup) => {
    setToggling(g.key);
    const next = !g.disabled;
    try {
      const r = await setSiteDisabled({ itemIds: g.items.map((i) => i.id) }, next, actor);
      toast(
        r.pushed
          ? { title: next ? 'Ширина выключена на сайте' : 'Ширина включена на сайте' }
          : { title: 'Сохранено, на сайт не ушло', description: r.pushError || undefined, variant: 'destructive' }
      );
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setToggling(null);
    }
  };

  const productOptions = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((i) => {
      if (i.siteProductId && !map.has(i.siteProductId)) {
        map.set(i.siteProductId, (i.name || '').replace(/\s+\d+×\d+$/, ''));
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const byView: Record<View, SiteWidthGroup[]> = {
    active,
    noMaterials,
    noPrice,
    lowProfit,
    disabled,
    archived,
  };
  const q = query.trim().toLowerCase();
  const shown = byView[view]
    .filter((g) => product === 'all' || g.items[0].siteProductId === product)
    .filter(
      (g) =>
        !q ||
        g.title.toLowerCase().includes(q) ||
        g.items.some((i) => (i.article || '').toLowerCase().includes(q))
    )
    .sort((a, b) => a.title.localeCompare(b.title, 'ru') || (a.width || 0) - (b.width || 0));

  const toggleOpen = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const views: { value: View; label: string; count: number }[] = [
    { value: 'active', label: 'Все ширины', count: active.length },
    { value: 'noMaterials', label: 'Без расхода', count: noMaterials.length },
    { value: 'noPrice', label: 'Без цены', count: noPrice.length },
    { value: 'lowProfit', label: 'Ниже цели', count: lowProfit.length },
    { value: 'disabled', label: 'Выключены', count: disabled.length },
    { value: 'archived', label: 'Архив', count: archived.length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Название, артикул и размер приходят с сайта. Себестоимость — из «Себестоимости товара», если
          проставлен расход. Цена и включение товара отправляются на сайт.
        </p>
        <Button onClick={handleSync} disabled={syncing}>
          <Icon
            name={syncing ? 'Loader2' : 'RefreshCw'}
            size={16}
            className={`mr-1.5 ${syncing ? 'animate-spin' : ''}`}
          />
          {syncing ? 'Загружаю…' : 'Загрузить товары с сайта'}
        </Button>
      </div>

      <SitePricingPanel pricing={pricing} canEdit={isAdmin} actor={actor} onSaved={setPricing} />

      <div className="flex flex-wrap items-center gap-2">
        {views.map((v) => (
          <button
            key={v.value}
            type="button"
            onClick={() => setView(v.value)}
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
          onChange={(e) => setProduct(e.target.value)}
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
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 w-full sm:w-56"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка…
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {items.length === 0
            ? 'Товаров пока нет — нажмите «Загрузить товары с сайта».'
            : 'Ничего не найдено.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Карточка</th>
                <th className="px-3 py-2 font-medium">Ширина</th>
                <th className="px-3 py-2 font-medium">Высоты</th>
                <th className="px-3 py-2 font-medium">Расход</th>
                <th className="px-3 py-2 font-medium">Себестоимость</th>
                <th className="px-3 py-2 font-medium">Цена на сайте</th>
                <th className="px-3 py-2 font-medium">Чистая прибыль</th>
                <th className="px-3 py-2 font-medium">На сайте</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((g) => {
                const isOpen = open.has(g.key);
                return (
                  <Fragment key={g.key}>
                    <tr className={`border-t border-border align-top ${g.disabled ? 'bg-muted/40' : ''}`}>
                      <td className="px-3 py-2">
                        <span className="font-medium">{g.title}</span>
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
                          onClick={() => toggleOpen(g.key)}
                          className="inline-flex items-center gap-1 text-sky-700 hover:underline"
                        >
                          <Icon name={isOpen ? 'ChevronUp' : 'ChevronDown'} size={14} />
                          {g.items.length} шт
                          {g.heights.length > 0 &&
                            ` · ${Math.min(...g.heights)}–${Math.max(...g.heights)}`}
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
                          range={range}
                          canEdit={isAdmin && !g.archived}
                          actor={actor}
                          onSaved={load}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <SiteProfitCell
                          item={{ price: priceOf(g), cost: g.cost }}
                          pricing={pricing}
                          target={targetOf(g)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {isAdmin && !g.archived ? (
                          <Button
                            size="sm"
                            variant={g.disabled ? 'default' : 'outline'}
                            disabled={toggling === g.key}
                            onClick={() => toggleDisabled(g)}
                          >
                            {g.disabled ? 'Включить' : 'Выключить'}
                          </Button>
                        ) : g.disabled ? (
                          <span className="text-amber-700">выключена</span>
                        ) : (
                          <span className="text-emerald-700">продаётся</span>
                        )}
                        {g.partlyDisabled && (
                          <p className="mt-0.5 text-xs text-amber-700">часть высот выключена</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => setEditing(g)}>
                          <Icon name="Pencil" size={14} className="mr-1" />
                          Расход
                        </Button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t border-border/50 bg-muted/20">
                        <td colSpan={9} className="px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {g.items.map((i) => (
                              <span
                                key={i.id}
                                className={`rounded border border-border bg-background px-2 py-0.5 text-xs ${
                                  i.disabled ? 'opacity-50' : ''
                                }`}
                                title={i.name}
                              >
                                <span className="font-mono">{i.article}</span>
                                <span className="ml-1 text-muted-foreground">
                                  {i.width}×{i.height}
                                  {i.price != null && i.price !== priceOf(g) ? ` · ${rub(i.price)}` : ''}
                                  {i.disabled ? ' · выкл' : ''}
                                </span>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <SiteItemMaterialsDialog
        group={editing}
        materials={materials}
        onClose={() => setEditing(null)}
        onSaved={load}
      />
    </div>
  );
};

export default SiteProductsTab;
