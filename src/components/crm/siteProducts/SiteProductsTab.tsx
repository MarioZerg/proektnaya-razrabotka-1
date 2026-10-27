import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchMarketplaceItems, type MarketplaceItem } from '@/lib/marketplaceItemsApi';
import { fetchMaterialsData, type Material } from '@/lib/materialsApi';
import { syncSiteProducts } from '@/lib/siteOrdersApi';
import SiteItemMaterialsDialog from '@/components/crm/siteProducts/SiteItemMaterialsDialog';

type View = 'active' | 'noMaterials' | 'archived';

/** «Товары для интеграций» магазина мегатюль.рф: одна строка — один артикул размера. */
const SiteProductsTab = ({ shopId }: { shopId: number }) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [items, setItems] = useState<MarketplaceItem[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>('active');
  const [product, setProduct] = useState<string>('all');
  const [editing, setEditing] = useState<MarketplaceItem | null>(null);

  const load = () => {
    setLoading(true);
    fetchMarketplaceItems()
      .then(({ items: list }) => setItems(list.filter((i) => i.shopId === shopId)))
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

  const productOptions = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((i) => {
      if (i.siteProductId && !map.has(i.siteProductId)) {
        map.set(i.siteProductId, (i.name || '').replace(/\s+\d+×\d+$/, ''));
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const base = view === 'archived' ? archived : view === 'noMaterials' ? noMaterials : active;
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
    { value: 'archived', label: 'Архив', count: archived.length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Артикулы размеров с сайта. Расход материалов вписывается здесь и в магазин не уходит.
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
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Артикул</th>
                <th className="px-3 py-2 font-medium">Название</th>
                <th className="px-3 py-2 font-medium">Ткань</th>
                <th className="px-3 py-2 font-medium">Размер, см</th>
                <th className="px-3 py-2 font-medium">Расход</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs">{i.article}</td>
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
                  <td className="px-3 py-2">{i.material || '—'}</td>
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
