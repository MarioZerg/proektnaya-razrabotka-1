const ORDERS_URL = 'https://functions.poehali.dev/1d8ed922-bded-4f5a-a367-a0742711203a';

export interface LivePerson {
  id: number;
  name: string;
  /** Должность, в которой человек вышел на смену: cutter / sewer / packer. */
  role: string;
  workshopId: number | null;
  workshopName: string | null;
  shiftOpenedAt: string | null;
  canOverlock: boolean;
}

export interface LiveOrder {
  id: number;
  orderNumber: string;
  marketplace: string;
  orderType: string;
  material: string | null;
  width: number | null;
  height: number | null;
  sewingStatus: string;
  requiresOverlock: boolean;
  overlockedAt: string | null;
  overlockUserId: number | null;
  overlockTakenAt: string | null;
  assignedUserId: number | null;
  cutterUserId: number | null;
  sewerUserId: number | null;
  packerUserId: number | null;
  cutAt: string | null;
  takenAt: string | null;
  sewnAt: string | null;
  packedAt: string | null;
  workshopId: number | null;
  groupKey: string | null;
  groupSize: number | null;
  groupPosition: number | null;
  isCancelled: boolean;
}

export type LiveEventKind = 'cut' | 'overlock' | 'taken' | 'sewn' | 'packed';

export interface LiveEvent {
  kind: LiveEventKind;
  at: string;
  orderId: number;
  orderNumber: string;
  userId: number | null;
  workshopId: number | null;
}

export interface LiveCounts {
  new: number;
  cutting: number;
  cutReady: number;
  overlock: number;
  sewing: number;
  stickering: number;
  doneToday: number;
}

export interface LiveFloorData {
  now: string;
  people: LivePerson[];
  orders: LiveOrder[];
  counts: LiveCounts;
  events: LiveEvent[];
  /** Сделано сегодня: userId → { cut, overlock, sewn, packed }. */
  today: Record<string, Partial<Record<'cut' | 'overlock' | 'sewn' | 'packed', number>>>;
  names: Record<string, string>;
}

export const fetchLiveFloor = async (): Promise<LiveFloorData> => {
  const res = await fetch(`${ORDERS_URL}?liveFloor=1`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить живой цех');
  return {
    now: data.now,
    people: data.people || [],
    orders: data.orders || [],
    counts: data.counts,
    events: data.events || [],
    today: data.today || {},
    names: data.names || {},
  };
};
