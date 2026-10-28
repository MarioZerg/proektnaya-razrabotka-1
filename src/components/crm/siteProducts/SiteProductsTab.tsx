import { useEffect, useMemo, useState } from 'react';
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
import { siteProfit } from '@/lib/sitePricing';
import SitePriceCell from '@/components/crm/siteProducts/SitePriceCell';
import SiteItemMaterialsDialog from '@/components/crm/siteProducts/SiteItemMaterialsDialog';

type View = 'active' | 'noMaterials' | 'noPrice' | 'lowProfit' | 'disabled' | 'archived';

const DEFAULT_PRICING: SitePricing = {
  targetProfitPct: 30,
  taxPct: 6,
  acquiringPct: 2,
  bloggerPct: 10,
  deliveryRub: 0,
};

const rub = (v: number) => `${v.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`;

/** «Товары для интеграций» магазина мегатюль.рф: одна строка — один артикул размера. */
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
  const [editing, setEditing] = useState<SiteCatalogItem | null>(null);
  const [toggling, setToggling] = useState<number | null>(null);
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

  const active = items.filter((i) => !i.archivedAt);
  const archived = items.filter((i) => i.archivedAt);
  const noMaterials = active.filter((i) => !i.materialsCount);
  const noPrice = active.filter((i) => i.price == null);
  const disabled = active.filter((i) => i.disabled);
  const lowProfit = active.filter(
    (i) =>
      i.price != null &&
      i.cost != null &&
      siteProfit(i.price, i.cost, pricing, true).profitPct < pricing.targetProfitPct - 0.5
  );

  const toggleDisabled = async (i: SiteCatalogItem) => {
    setToggling(i.id);
    try {
      const r = await setSiteDisabled({ itemIds: [i.id] }, !i.disabled, actor);
      toast(
        r.pushed
          ? { title: i.disabled ? 'Товар включён на сайте' : 'Товар выключен на сайте' }
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

  const byView: Record<View, SiteCatalogItem[]> = {
    active,
    noMaterials,
    noPrice,
    lowProfit,
    disabled,
    archived,
  };
  const base = byView[view];
  const q = query.trim().toLowerCase();
  const shown = base
    .filter((i) => product === 'all' || i.siteProductId === product)
    .filter(
      (i) =>
        !q ||
        (i.article || '').toLowerCase().includes(q) ||
        (i.name || '').toLowerCase().includes(q)
    )
    .sort(
      (a, b) =>
        (a.article || '').localeCompare(b.article || '') ||
        (a.width || 0) - (b.width || 0) ||
        (a.height || 0) - (b.height || 0)
    );

  const views: { value: View; label: string; count: number }[] = [
    { value: 'active', label: 'Все', count: active.length },
    { value: 'noMaterials', label: 'Без расхода', count: noMaterials.length },
    { value: 'noPrice', label: 'Без цены', count: noPrice.length },
    { value: 'lowProfit', label: `Прибыль < ${pricing.targetProfitPct}%`, count: lowProfit.length },
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
                <th className="px-3 py-2 font-medium">Название</th>
                <th className="px-3 py-2 font-medium">Артикул</th>
                <th className="px-3 py-2 font-medium">Ширина × высота, см</th>
                <th className="px-3 py-2 font-medium">Расход</th>
                <th className="px-3 py-2 font-medium">Себестоимость</th>
                <th className="px-3 py-2 font-medium">Цена на сайте</th>
                <th className="px-3 py-2 font-medium">Чистая прибыль</th>
                <th className="px-3 py-2 font-medium">На сайте</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className={`border-t border-border ${i.disabled ? 'bg-muted/40' : ''}`}>
                  <td className="px-3 py-2">
                    {i.name}
                    {i.archivedAt && (
                      <Badge variant="outline" className="ml-2 border-amber-300 bg-amber-50 text-amber-800">
                        архив с {new Date(i.archivedAt).toLocaleDateString('ru-RU')}
                      </Badge>
                    )}
                    {!i.siteProductId && (
                      <Badge variant="outline" className="ml-2">
                        вручную
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{i.article}</td>
                  <td className="px-3 py-2">
                    {i.width && i.height ? `${i.width}×${i.height}` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {i.materialsCount ? (
                      <span className="text-emerald-700">материалов: {i.materialsCount}</span>
                    ) : (
                      <span className="text-amber-700">не проставлен</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {i.cost != null ? rub(i.cost) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <SitePriceCell
                      item={i}
                      pricing={pricing}
                      canEdit={isAdmin && !i.archivedAt}
                      actor={actor}
                      onSaved={load}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <SiteProfitCell item={i} pricing={pricing} />
                  </td>
                  <td className="px-3 py-2">
                    {isAdmin && !i.archivedAt ? (
                      <Button
                        size="sm"
                        variant={i.disabled ? 'default' : 'outline'}
                        disabled={toggling === i.id}
                        onClick={() => toggleDisabled(i)}
                      >
                        {i.disabled ? 'Включить' : 'Выключить'}
                      </Button>
                    ) : i.disabled ? (
                      <span className="text-amber-700">выключен</span>
                    ) : (
                      <span className="text-emerald-700">продаётся</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(i)}>
                      <Icon name="Pencil" size={14} className="mr-1" />
                      Расход
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SiteItemMaterialsDialog
        item={editing}
        materials={materials}
        onClose={() => setEditing(null)}
        onSaved={load}
      />
    </div>
  );
};

export default SiteProductsTab;
