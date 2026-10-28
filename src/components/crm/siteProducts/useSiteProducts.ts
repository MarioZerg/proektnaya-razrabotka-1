import { useEffect, useMemo, useState } from 'react';
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
import { siteProfit, targetProfit } from '@/lib/sitePricing';
import { groupByWidth, type SiteWidthGroup } from '@/components/crm/siteProducts/siteWidthGroups';
import { DEFAULT_PRICING, type View } from '@/components/crm/siteProducts/siteProductsShared';

/** Данные и действия вкладки «Товары, цены и прибыль». */
const useSiteProducts = (shopId: number) => {
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
  const [openMaterials, setOpenMaterials] = useState<Set<string>>(new Set());
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
  const targetOf = (g: SiteWidthGroup) => targetProfit(g.width, pricing);
  const widths = [...new Set(active.map((g) => g.width).filter((w): w is number => w != null))].sort(
    (a, b) => a - b
  );
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

  const toggleMaterialDisabled = async (title: string) => {
    const groups = active.filter((g) => g.title === title);
    const all = groups.flatMap((g) => g.items);
    const next = !all.every((i) => i.disabled);
    if (
      next &&
      !window.confirm(`Снять с продажи на сайте всю ткань «${title}» (${groups.length} шир.)?`)
    )
      return;
    setToggling(`mat:${title}`);
    try {
      const r = await setSiteDisabled({ itemIds: all.map((i) => i.id) }, next, actor);
      toast(
        r.pushed
          ? { title: next ? `«${title}» снята с продажи` : `«${title}» снова продаётся` }
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
        g.items.some(
          (i) =>
            (i.article || '').toLowerCase().includes(q) ||
            (i.internalSku || '').toLowerCase().includes(q)
        )
    )
    .sort((a, b) => a.title.localeCompare(b.title, 'ru') || (a.width || 0) - (b.width || 0));

  const materialGroups = useMemo(() => {
    const map = new Map<string, SiteWidthGroup[]>();
    shown.forEach((g) => map.set(g.title, [...(map.get(g.title) || []), g]));
    return [...map.entries()];
  }, [shown]);
  const autoOpen = !!q || product !== 'all';
  const toggleMaterial = (title: string) =>
    setOpenMaterials((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  const toggleOpen = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const views: { value: View; label: string; count: number }[] = [
    { value: 'active', label: 'Все товары', count: active.length },
    { value: 'noMaterials', label: 'Без расхода', count: noMaterials.length },
    { value: 'noPrice', label: 'Без цены', count: noPrice.length },
    { value: 'lowProfit', label: 'Ниже цели', count: lowProfit.length },
    { value: 'disabled', label: 'Выключены', count: disabled.length },
    { value: 'archived', label: 'Архив', count: archived.length },
  ];

  return {
    items,
    pricing,
    setPricing,
    materials,
    loading,
    syncing,
    query,
    setQuery,
    view,
    setView,
    product,
    setProduct,
    editing,
    setEditing,
    toggling,
    open,
    openMaterials,
    isAdmin,
    actor,
    load,
    handleSync,
    active,
    lowProfit,
    targetOf,
    widths,
    priceOf,
    toggleDisabled,
    toggleMaterialDisabled,
    productOptions,
    shown,
    materialGroups,
    autoOpen,
    toggleMaterial,
    toggleOpen,
    views,
  };
};

export default useSiteProducts;
