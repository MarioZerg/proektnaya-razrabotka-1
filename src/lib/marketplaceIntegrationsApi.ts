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
  /** Какому магазину принадлежат ключи: МЕГАТЮЛЬ или ДЮНА. */
  shopId: number;
}

/**
 * Магазин — отдельный кабинет на площадках со своими ключами и товарами.
 * Производство при этом общее: заказы обоих магазинов шьёт один цех.
 */
export interface Shop {
  id: number;
  code: string;
  name: string;
  /** Цвет метки, чтобы заказы двух магазинов различались одним взглядом. */
  color: string;
}

export const fetchMarketplaceIntegrations = async (): Promise<{
  integrations: MarketplaceIntegration[];
  shops: Shop[];
}> => {
  const res = await fetch(MARKETPLACE_INTEGRATIONS_URL);
  const data = await res.json();
  return { integrations: data.integrations || [], shops: data.shops || [] };
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
  shopId: number,
  fields: Partial<{ isEnabled: boolean; credentials: Record<string, string> }>,
  actorId?: number
) => postAction({ action: 'update', marketplaceCode, shopId, actorId, ...fields });
