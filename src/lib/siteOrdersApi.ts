const SITE_URL = 'https://functions.poehali.dev/dbc4d229-e722-40bc-aa47-f47bed23dab5';

export interface SiteSyncResult {
  created: number;
  orders: string[];
  skippedExisting: number;
  unmatched: { orderNumber: string; sku?: string | null; name: string }[];
  labelsUpdated?: number;
}

export interface SiteStatus {
  shopId: number;
  siteUrl: string;
  connected: boolean;
}

const post = async (body: Record<string, unknown>) => {
  const res = await fetch(SITE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка связи с магазином');
  return data;
};

export const fetchSiteStatus = async (): Promise<SiteStatus> => {
  const res = await fetch(`${SITE_URL}?action=status`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
};

export interface SiteProductsSyncResult {
  created: number;
  updated?: number;
  restored?: number;
  archived?: number;
  siteProducts?: number;
  siteCards?: number;
}

/** Забирает артикулы размеров сайта в «Товары для интеграций» этого магазина. */
export const syncSiteProducts = (actor?: { id?: number; name?: string }): Promise<SiteProductsSyncResult> =>
  post({ action: 'sync_products', actorId: actor?.id, actorName: actor?.name });

/** Забирает оплаченные заказы мегатюль.рф на конвейер. */
export const syncSiteOrders = (actor?: { id?: number; name?: string }): Promise<SiteSyncResult> =>
  post({ action: 'sync', actorId: actor?.id, actorName: actor?.name });

/** Этикетка Ozon Доставки, которую магазин передал вместе с заказом. */
export const fetchSiteLabel = async (
  ref: { orderId?: number; orderNumber?: string },
): Promise<{ kind: 'pdf' | 'png'; base64: string; trackingNumber?: string | null }> =>
  post({ action: 'label', orderId: ref.orderId, orderNumber: ref.orderNumber });

/** Печатает этикетку Ozon Доставки заказа сайта. */
export const printSiteLabel = async (ref: { orderId?: number; orderNumber?: string }) => {
  const { printLabelPdf, printLabelPng } = await import('@/lib/printMarketplaceLabel');
  const label = await fetchSiteLabel(ref);
  if (label.kind === 'pdf') await printLabelPdf(label.base64, 'Ozon Доставка');
  else printLabelPng(label.base64, 'Ozon Доставка');
};

export interface SiteCatalogItem {
  id: number;
  name: string;
  article: string | null;
  width: number | null;
  height: number | null;
  material: string | null;
  siteProductId: string | null;
  archivedAt: string | null;
  price: number | null;
  disabled: boolean;
  pushedAt: string | null;
  pushError: string | null;
  materialsCount: number;
  /** Себестоимость из «Себестоимости товара»; null — расход не проставлен. */
  cost: number | null;
}

export interface SitePricing {
  /** Чистая прибыль со штуки: с самой дешёвой вещи каталога … с самой дорогой. */
  minProfitRub: number;
  maxProfitRub: number;
  taxPct: number;
  acquiringPct: number;
  /** Доля блогера от цены витрины — сверх нашей прибыли. */
  bloggerPct: number;
}

export const fetchSiteCatalog = (): Promise<{
  items: SiteCatalogItem[];
  costAvailable: boolean;
  pricing: SitePricing;
}> => post({ action: 'catalog' });

export const saveSitePricing = (
  pricing: SitePricing,
  actor?: { id?: number; name?: string }
): Promise<SitePricing> =>
  post({ action: 'save_pricing', ...pricing, actorId: actor?.id, actorName: actor?.name });

export interface SitePushResult {
  pushed: boolean;
  pushError: string | null;
  changed?: number;
}

export const setSitePrice = (
  itemId: number,
  price: number | null,
  actor?: { id?: number; name?: string }
): Promise<SitePushResult> =>
  post({ action: 'set_price', itemId, price, actorId: actor?.id, actorName: actor?.name });

export const setSiteDisabled = (
  target: { itemIds?: number[]; materialId?: number },
  disabled: boolean,
  actor?: { id?: number; name?: string }
): Promise<SitePushResult> =>
  post({ action: 'set_disabled', ...target, disabled, actorId: actor?.id, actorName: actor?.name });

export interface LowFabric {
  materialId: number;
  name: string;
  meters: number;
  activeItems: number;
  disabledItems: number;
}

export const fetchLowFabric = (): Promise<{ threshold: number; fabrics: LowFabric[] }> =>
  post({ action: 'low_fabric' });
