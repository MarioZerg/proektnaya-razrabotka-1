import type { MarketplaceCode } from '@/lib/marketplaceIntegrationsApi';

export interface MarketplaceCredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
}

export interface MarketplaceConfigItem {
  code: MarketplaceCode;
  name: string;
  className: string;
  fields: MarketplaceCredentialField[];
}

export const marketplaceIntegrationsConfig: MarketplaceConfigItem[] = [
  {
    code: 'ozon',
    name: 'OZON',
    className: 'text-[#005BFF]',
    fields: [
      { key: 'clientId', label: 'Client ID' },
      { key: 'apiKey', label: 'API-ключ', secret: true },
    ],
  },
  {
    code: 'wildberries',
    name: 'Wildberries',
    className: 'text-[#CB11AB]',
    fields: [{ key: 'apiKey', label: 'API-токен', secret: true }],
  },
  {
    code: 'yandex_market',
    name: 'Яндекс Маркет',
    className: 'text-[#FFCC00]',
    fields: [
      { key: 'campaignId', label: 'ID кампании' },
      { key: 'apiKey', label: 'API-токен', secret: true },
    ],
  },
  {
    code: 'megamarket',
    name: 'МегаМаркет',
    className: 'text-[#00A046]',
    fields: [{ key: 'apiKey', label: 'API-токен', secret: true }],
  },
  {
    code: 'lemana_pro',
    name: 'Лемана PRO',
    className: 'text-[#DA291C]',
    fields: [
      { key: 'clientId', label: 'Client ID' },
      { key: 'apiKey', label: 'API-ключ', secret: true },
    ],
  },
  {
    code: 'avito',
    name: 'Avito',
    className: 'text-[#00AAFF]',
    fields: [
      { key: 'clientId', label: 'Client ID' },
      { key: 'clientSecret', label: 'Client Secret', secret: true },
    ],
  },
];
