import type { SiteCatalogItem } from '@/lib/siteOrdersApi';

/** Одна ширина одной карточки сайта: все высоты с общей себестоимостью и ценой. */
export interface SiteWidthGroup {
  key: string;
  title: string;
  width: number | null;
  items: SiteCatalogItem[];
  heights: number[];
  cost: number | null;
  /** Общая цена, если у всех высот одинаковая; null — не задана; 'mixed' — разная. */
  price: number | null | 'mixed';
  materialsCount: number;
  noMaterials: number;
  disabled: boolean;
  partlyDisabled: boolean;
  pushError: string | null;
  archived: boolean;
  manual: boolean;
}

const baseName = (name: string) => name.replace(/\s+\d+×\d+$/, '').trim();

export const groupByWidth = (items: SiteCatalogItem[]): SiteWidthGroup[] => {
  const map = new Map<string, SiteCatalogItem[]>();
  items.forEach((i) => {
    const key = `${i.siteProductId || baseName(i.name)}|${i.width ?? '—'}`;
    map.set(key, [...(map.get(key) || []), i]);
  });
  return [...map.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => (a.height || 0) - (b.height || 0));
    const prices = new Set(sorted.map((i) => i.price ?? null));
    const costs = sorted.map((i) => i.cost).filter((c): c is number => c != null);
    const disabledCount = sorted.filter((i) => i.disabled).length;
    return {
      key,
      title: baseName(sorted[0].name) || sorted[0].article || '—',
      width: sorted[0].width,
      items: sorted,
      heights: sorted.map((i) => i.height).filter((h): h is number => h != null),
      cost: costs.length ? Math.max(...costs) : null,
      price: prices.size === 1 ? [...prices][0] : 'mixed',
      materialsCount: Math.max(...sorted.map((i) => i.materialsCount)),
      noMaterials: sorted.filter((i) => !i.materialsCount).length,
      disabled: disabledCount === sorted.length,
      partlyDisabled: disabledCount > 0 && disabledCount < sorted.length,
      pushError: sorted.find((i) => i.pushError)?.pushError ?? null,
      archived: sorted.every((i) => i.archivedAt),
      manual: sorted.every((i) => !i.siteProductId),
    };
  });
};
