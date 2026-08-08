const SUPPLIERS_URL = 'https://functions.poehali.dev/eb3fba8a-def9-443a-a867-97243dacc9f8';

/** Валюты, в которых поставщики выставляют цены. */
export const CURRENCIES = ['RUB', 'USD', 'EUR', 'CNY'] as const;

export const currencySymbols: Record<string, string> = {
  RUB: '₽',
  USD: '$',
  EUR: '€',
  CNY: '¥',
};

/** Цена одного материала у конкретного поставщика. */
export interface SupplierPrice {
  materialId: number;
  materialName?: string;
  unit?: string;
  /** Цена за пог.м. или шт в валюте позиции. */
  price: number;
  /** У ткани может быть USD, у тесьмы — фиксированная цена в RUB. */
  currency: string;
}

export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  /** Основная валюта поставщика. */
  currency: string;
  /** Курс валюты к рублю по умолчанию — подставляется при приёмке. */
  exchangeRate: number | null;
  /** Прайс поставщика по материалам. */
  prices: SupplierPrice[];
}

export const fetchSuppliers = async (): Promise<Supplier[]> => {
  const res = await fetch(SUPPLIERS_URL);
  const data = await res.json();
  return data.suppliers || [];
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(SUPPLIERS_URL, {
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

export const createSupplier = (payload: {
  name: string;
  phone?: string;
  address?: string;
  comment?: string;
  currency?: string;
  exchangeRate?: number | null;
}) => postAction({ action: 'create', ...payload });

export const updateSupplier = (
  id: number,
  fields: Partial<{
    name: string;
    phone: string;
    address: string;
    comment: string;
    currency: string;
    exchangeRate: number | null;
  }>
) => postAction({ action: 'update', id, ...fields });

/** Сохраняет прайс поставщика — цены материалов в его валюте. */
export const setSupplierPrices = (
  id: number,
  prices: Array<{ materialId: number; price: number; currency: string }>
) => postAction({ action: 'set_prices', id, prices });

export const deleteSupplier = (id: number) => postAction({ action: 'delete', id });
