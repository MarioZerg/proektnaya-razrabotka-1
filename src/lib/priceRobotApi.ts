import func2url from '../../backend/func2url.json';

const URL = (func2url as Record<string, string>).price_robot;

export type RobotMarketplace = 'ozon' | 'wildberries' | 'yandex_market';

/** Карточка витрины: из каталога владелец набирает, что поднимать. */
export interface CatalogItem {
  itemId: number;
  name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  sku: string | null;
  shopId: number | null;
  shopName: string | null;
  price: number;
}

/** Один шаг: что подняли и почему. */
export interface RobotRun {
  ranAt: string;
  decision: string;
  reason: string;
  stepPercent: number | null;
  itemsPushed: number;
  driftPercent?: number | null;
  unitsAfter?: number | null;
  unitsBefore?: number | null;
  unitsChange?: number | null;
  dryRun?: boolean;
}

export interface RobotStatus {
  catalog: CatalogItem[];
  pendingLeft: number;
  maxStepPercent: number;
  runs: RobotRun[];
}

const check = async (r: Response) => {
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Ошибка запроса');
  return d;
};

export const fetchRobotStatus = async (
  marketplace: RobotMarketplace,
  actorId?: number,
): Promise<RobotStatus> => {
  const d = await check(
    await fetch(
      `${URL}?action=status&marketplace=${marketplace}&actorId=${actorId ?? ''}`,
    ),
  );
  return {
    catalog: d.catalog || [],
    pendingLeft: d.pendingLeft || 0,
    maxStepPercent: d.maxStepPercent || 3,
    runs: d.runs || [],
  };
};

export interface MoveResult {
  reason: string;
  pushed: number;
  inProgress?: boolean;
  left?: number;
}

/**
 * Поднять цены. Плюс — только вверх: опускать этой кнопкой больше нельзя.
 *
 * itemIds — карточки под фильтром. Без списка двигаем весь ассортимент
 * площадки. scope уходит в журнал словами, чтобы через месяц было видно,
 * что именно подорожало.
 */
export const moveRobotPrices = async (
  marketplace: RobotMarketplace,
  step: number,
  note: string,
  actorId?: number,
  itemIds?: number[],
  scope?: string,
): Promise<MoveResult> =>
  check(
    await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'move',
        marketplace,
        step,
        note,
        actorId,
        ...(itemIds ? { itemIds } : {}),
        ...(scope ? { scope } : {}),
      }),
    }),
  );

/**
 * Поднять цены за одно нажатие: сервер шлёт пачками, досыл идёт сам.
 */
export const moveRobotPricesAll = async (
  marketplace: RobotMarketplace,
  step: number,
  note: string,
  actorId?: number,
  itemIds?: number[],
  scope?: string,
  onProgress?: (pushed: number, left: number) => void,
): Promise<MoveResult> => {
  let last = await moveRobotPrices(
    marketplace,
    step,
    note,
    actorId,
    itemIds,
    scope,
  );

  let stumbles = 0;
  for (let guard = 0; last.inProgress && last.left && guard < 400; guard++) {
    onProgress?.(last.pushed || 0, last.left);

    try {
      last = await moveRobotPrices(
        marketplace,
        step,
        note,
        actorId,
        itemIds,
        scope,
      );
      stumbles = 0;
    } catch (e) {
      stumbles += 1;
      if (stumbles >= 5) throw e;
      await new Promise((r) => setTimeout(r, 1500 * stumbles));
    }
  }

  return last;
};
