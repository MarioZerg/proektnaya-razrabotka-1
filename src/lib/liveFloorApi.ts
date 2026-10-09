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
  /** Фото из профиля или MAX: COALESCE(avatar_url, max_avatar_url). */
  avatarUrl?: string | null;
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

export interface LiveRaceRunner {
  id: number;
  name: string;
  role: string;
  avatarUrl?: string | null;
  /** 0…1 по скрытой норме п.м. На карте цифры не показываем. */
  progress?: number;
  finished?: boolean;
  steps?: number;
  done?: number;
  place: number;
}

export interface LiveRace {
  prize: number;
  winner: { id: number; name: string; variki: number } | null;
  runners: LiveRaceRunner[];
  metersGoal?: number;
  steps?: number;
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
  race?: LiveRace | null;
}

const EMPTY_COUNTS: LiveCounts = {
  new: 0,
  cutting: 0,
  cutReady: 0,
  overlock: 0,
  sewing: 0,
  stickering: 0,
  doneToday: 0,
};

export const fetchLiveFloor = async (): Promise<LiveFloorData> => {
  const res = await fetch(`${ORDERS_URL}?liveFloor=1`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить живой цех');
  // Ответ без снимка цеха (например, отвечала старая копия сервера сразу после
  // выкладки — она отдаёт обычный список заказов) считаем сбоем: иначе блок
  // получал пустые счётчики, падал и пропадал с главной целиком.
  if (!data || !data.counts || !Array.isArray(data.people)) {
    throw new Error('Сервер прислал неполные данные — повторим через несколько секунд');
  }
  return {
    now: data.now || new Date().toISOString(),
    people: data.people || [],
    orders: data.orders || [],
    counts: { ...EMPTY_COUNTS, ...data.counts },
    events: data.events || [],
    today: data.today || {},
    names: data.names || {},
    race: data.race || null,
  };
};