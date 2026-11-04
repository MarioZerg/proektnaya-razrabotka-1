/** Автопредложка поставки FBO в пошив (Ozon): расчёт, данные Ozon, создание. */
const URL = 'https://functions.poehali.dev/dc70091f-a346-4658-ac9b-93e5e58f7355';

export type SewGrade = 'hot' | 'normal' | 'weak' | null;

export interface SewLine {
  sku: number;
  itemId: number;
  name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  /** Продано в этот кластер за 28 дней. */
  sold: number;
  /** Продано по всем кластерам за 28 дней. */
  soldTotal: number;
  /** На Ozon в кластере + в пути + наши поставки в работе. */
  onOzon: number;
  need: number;
  grade: SewGrade;
  popularSize: boolean;
  quantity: number;
  note: string | null;
}

export interface SewClusterRow {
  cluster: string;
  orders: number;
  localPercent: number | null;
  need: number;
  onOzon: number;
  inWork: number;
  home: boolean;
  score: number;
}

export interface SewFabricRow {
  id: number;
  name: string;
  warehouse: number;
  workshop: number;
  queue: number;
  free: number;
  use: number;
  after: number;
}

export interface SewLocalization {
  now: number | null;
  after: number | null;
  clusterNow: number | null;
  clusterAfter: number | null;
  orders: number;
}

export interface SewPlan {
  cluster: string;
  home: string | null;
  requested: number;
  pieces: number;
  note: string | null;
  lines: SewLine[];
  weak: SewLine[];
  skipped: SewLine[];
  fabric: SewFabricRow[];
  clusters: SewClusterRow[];
  localization: SewLocalization;
}

export interface SewHistoryRow {
  id: number;
  cluster: string;
  pieces: number;
  fromStock: number;
  toSew: number;
  locNow: number | null;
  locAfter: number | null;
  supplyId: number;
  createdAt: string;
  createdBy: string | null;
  supplyStatus: string | null;
}

export interface SewState {
  localization: { now: number | null; orders: number };
  home: string | null;
  freshness: Record<string, { syncedTo: string | null; partial: boolean; updatedAt: string | null }>;
  history: SewHistoryRow[];
}

export interface SewCreated {
  supplyId: number;
  pieces: number;
  fromStock: number;
  intercepted: number;
  toSew: number;
  repeat?: boolean;
}

const post = async <T>(payload: Record<string, unknown>): Promise<T> => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    throw new Error('Сервер не ответил — повторите через несколько секунд');
  }
  if (!res.ok || data.errorMessage) {
    throw new Error(
      (data.error as string) ||
        (String(data.errorMessage || '').includes('timeout')
          ? 'Ozon отвечает медленно — повторите ещё раз, загрузка продолжится с того же места'
          : 'Ошибка запроса'),
    );
  }
  return data as T;
};

export const fetchSewState = (shopId: number) => post<SewState>({ action: 'state', shopId });

export const syncSewData = (shopId: number) =>
  post<{ geo: Record<string, unknown>; stock: { done?: boolean; error?: string; read?: number; skus?: number } }>({
    action: 'sync',
    shopId,
  });

export interface SewPlanParams {
  pieces: number;
  cluster?: string | null;
  removed?: number[];
  added?: number[];
}

export const buildSewPlan = (shopId: number, p: SewPlanParams) =>
  post<SewPlan>({ action: 'build', shopId, ...p });

export const createSewSupply = (shopId: number, p: SewPlanParams, requestKey: string) =>
  post<SewCreated>({ action: 'create', shopId, ...p, requestKey });
