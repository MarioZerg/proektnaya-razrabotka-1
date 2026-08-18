const STOCKTAKES_URL = 'https://functions.poehali.dev/a737392b-5582-4cfd-ba50-185a19b73ee9';

/** Одна вещь в отчёте инвентаризации. */
export interface StocktakeItem {
  goodsWarehouseId: number | null;
  barcode: string;
  orderNumber: string | null;
  product: string | null;
  shelfName?: string | null;
  expectedShelfName?: string | null;
  scannedAt?: string | null;
  receivedAt?: string | null;
}

/** Полка: сколько вещей на ней числится и сколько уже пересчитано. */
export interface StocktakeShelf {
  shelfId: number;
  shelfName: string;
  expected: number;
  found: number;
}

export interface StocktakeReport {
  /** Сколько вещей всего числится на полках склада. */
  expected: number;
  found: StocktakeItem[];
  foundCount: number;
  /** Числится на складе, но не отсканировано — кандидаты на списание. */
  missing: StocktakeItem[];
  missingCount: number;
  /** Найдено не на своей полке — адрес поправится при подтверждении. */
  misplaced: StocktakeItem[];
  /** Отсканировано, но на складе не числится. */
  extra: StocktakeItem[];
  shelves: StocktakeShelf[];
}

export type StocktakeStatus =
  | 'in_progress'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export interface Stocktake {
  id: number;
  status: StocktakeStatus;
  startedByName: string | null;
  startedAt: string | null;
  closedAt: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
  note: string | null;
  expectedCount: number;
  foundCount: number;
  missingCount: number;
  extraCount: number;
  report?: StocktakeReport;
}

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(STOCKTAKES_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

export const fetchStocktakes = async (): Promise<Stocktake[]> => {
  const res = await fetch(STOCKTAKES_URL);
  const data = res.ok ? await res.json() : {};
  return Array.isArray(data.stocktakes) ? data.stocktakes : [];
};

/** Текущая незакрытая инвентаризация (или null, если пересчёт не идёт). */
export const fetchActiveStocktake = async (): Promise<Stocktake | null> => {
  const res = await fetch(`${STOCKTAKES_URL}?active=1`);
  const data = res.ok ? await res.json() : {};
  return data.stocktake || null;
};

export const fetchStocktake = async (id: number): Promise<Stocktake | null> => {
  const res = await fetch(`${STOCKTAKES_URL}?id=${id}`);
  const data = res.ok ? await res.json() : {};
  return data.stocktake || null;
};

export const startStocktake = (actorId?: number, actorName?: string) =>
  postAction({ action: 'start', actorId, actorName }) as Promise<{ id: number }>;

/** Скан стикера GW. shelfId — полка, у которой кладовщик стоит сейчас. */
export const scanStocktake = (payload: {
  stocktakeId: number;
  barcode: string;
  shelfId?: number | null;
  actorId?: number;
  actorName?: string;
}) =>
  postAction({ action: 'scan', ...payload }) as Promise<{
    barcode: string;
    orderNumber: string | null;
    product: string | null;
    shelfName: string | null;
    warning: string | null;
  }>;

export const undoStocktakeScan = (
  stocktakeId: number,
  barcode: string,
  actorId?: number,
  actorName?: string,
) => postAction({ action: 'undo_scan', stocktakeId, barcode, actorId, actorName });

export const closeStocktake = (
  stocktakeId: number,
  note: string,
  actorId?: number,
  actorName?: string,
) =>
  postAction({ action: 'close', stocktakeId, note, actorId, actorName }) as Promise<{
    missingCount: number;
  }>;

/** Подтверждение списывает недостачу безвозвратно, поэтому число ненайденных
 * вещей передаётся явно: если склад изменился с момента закрытия, сервер
 * остановится и покажет актуальную цифру. */
export const approveStocktake = (
  stocktakeId: number,
  confirmMissing: number,
  actorId?: number,
  actorName?: string,
) =>
  postAction({ action: 'approve', stocktakeId, confirmMissing, actorId, actorName }) as Promise<{
    disposed: number;
    moved: number;
  }>;

/** Отменить пересчёт: открыли по ошибке или начали не вовремя.
 * Товар не затрагивается — ничего не списывается и не перекладывается. */
export const cancelStocktake = (
  stocktakeId: number,
  reason?: string,
  actorId?: number,
  actorName?: string,
) => postAction({ action: 'cancel', stocktakeId, reason, actorId, actorName });

export const rejectStocktake = (
  stocktakeId: number,
  reason: string,
  actorId?: number,
  actorName?: string,
) => postAction({ action: 'reject', stocktakeId, reason, actorId, actorName });

export const STOCKTAKE_STATUS_LABEL: Record<StocktakeStatus, string> = {
  in_progress: 'Идёт пересчёт',
  pending_approval: 'Ждёт подтверждения',
  approved: 'Подтверждена',
  rejected: 'Возвращена на пересчёт',
  cancelled: 'Отменена',
};
