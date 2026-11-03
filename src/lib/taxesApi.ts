/** POEHALI: налоги с маркетплейсов живут в функции ad_spend — там же отчёты площадок. */
const AD_SPEND_URL = 'https://functions.poehali.dev/29442dba-b5a9-4e15-b9ba-5fdc52eef574';

export type TaxMarketplace = 'ozon' | 'wildberries' | 'yandex_market';

export const TAX_MARKETPLACES: { code: TaxMarketplace; label: string }[] = [
  { code: 'ozon', label: 'OZON' },
  { code: 'wildberries', label: 'Wildberries' },
  { code: 'yandex_market', label: 'Яндекс Маркет' },
];

export interface TaxWriteoff {
  id: number;
  amount: number;
  comment: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface TaxSummary {
  usnPct: number;
  vatPct: number;
  /** С какого месяца копится неуплаченный налог (YYYY-MM-01). */
  startMonth: string;
  /** Начислено с startMonth по площадкам: налог и база (начислено продавцу после удержаний). */
  byMarketplace: Record<TaxMarketplace, { tax: number; net: number }>;
  accrued: number;
  /** Уже уплачено — сумма списаний. */
  paid: number;
  /** Начислено минус уплачено. */
  balance: number;
  /** Последний начисленный месяц: сколько добавилось 1-го числа. */
  lastMonth: { month: string; byMarketplace: Partial<Record<TaxMarketplace, number>>; total: number } | null;
  /** Закрытые месяцы, по которым отчёт площадки ещё не пришёл. */
  waiting: { month: string; marketplaces: TaxMarketplace[] }[];
  writeoffs: TaxWriteoff[];
}

const post = async <T>(payload: Record<string, unknown>): Promise<T> => {
  const res = await fetch(AD_SPEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data as T;
};

export const fetchTaxes = (actorId: number) => post<TaxSummary>({ action: 'taxes', actorId });

export const writeOffTaxes = (actorId: number, amount: number, comment: string) =>
  post<TaxSummary>({ action: 'tax_writeoff', actorId, amount, comment });

export const deleteTaxWriteoff = (actorId: number, id: number) =>
  post<TaxSummary>({ action: 'tax_writeoff_delete', actorId, id });
