const MARKETPLACE_INTEGRATIONS_URL = 'https://functions.poehali.dev/74493687-7597-43cc-a138-fa8c1e7215b4';

export type MarketplaceCode =
  | 'ozon'
  | 'wildberries'
  | 'yandex_market'
  | 'megamarket'
  | 'lemana_pro'
  | 'avito';

export interface MarketplaceIntegration {
  marketplaceCode: MarketplaceCode;
  isEnabled: boolean;
  credentials: Record<string, string>;
  updatedAt: string;
}

export const fetchMarketplaceIntegrations = async (): Promise<MarketplaceIntegration[]> => {
  const res = await fetch(MARKETPLACE_INTEGRATIONS_URL);
  const data = await res.json();
  return data.integrations || [];
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(MARKETPLACE_INTEGRATIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

export const updateMarketplaceIntegration = (
  marketplaceCode: MarketplaceCode,
  fields: Partial<{ isEnabled: boolean; credentials: Record<string, string> }>,
  actorId?: number
) => postAction({ action: 'update', marketplaceCode, actorId, ...fields });
