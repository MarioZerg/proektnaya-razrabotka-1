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
