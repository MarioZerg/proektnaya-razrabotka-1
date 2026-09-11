const ROLLS_URL = 'https://functions.poehali.dev/10824802-d4e4-48de-b98a-0fc06f8412d5';

export type RollStatus = 'in_storage' | 'in_workshop' | 'completed';

export interface Roll {
  // Пустые поля сервер не присылает — список рулонов легче. Всё, что бывает пустым,
  // помечено необязательным: отсутствующее поле читается так же, как пустое.
  id: number;
  barcode: string;
  materialId: number;
  materialName?: string | null;
  unit?: string | null;
  workshopId?: number | null;
  workshopName?: string | null;
  shiftNumber?: number | null;
  initialQuantity: number;
  remainingQuantity: number;
  status: RollStatus;
  createdAt: string;
  completedAt?: string | null;
  /** По рулону было движение материала в текущей смене (заполняется при запросе с usedSinceUserId). */
  usedInShift?: boolean;
  /** Рулон другой смены этого же цеха: гость работает чужим материалом. */
  foreignShift?: boolean;
  /**
   * Закройщик отставил рулон из-за брака в начале полотна. Рулон физически ещё в цехе,
   * но в раскрой не идёт и ждёт, когда кладовщик заберёт его на склад или откажет.
   */
  defectFlaggedAt?: string | null;
  defectFlaggedByName?: string | null;
  defectReason?: string | null;
  /**
   * Рулон отгружен в цех, но смена его ещё не приняла. Работать с ним нельзя:
   * материал мог не доехать или приехать не в том количестве. Сначала цех
   * подтверждает приёмку поставки, потом рулон становится рабочим.
   */
  pendingAcceptance?: boolean;
  /** Недостача: сколько метража не хватило в рулоне при закрытии в цехе. */
  shortageQuantity?: number;
  /**
   * Сколько материала уже израсходовано с этого рулона на заказы.
   *
   * По нему терминал проверяет заявленную недостачу: если из рулона в 500 м уже
   * ушло в заказы 470, то «не хватило 300 м» быть не может — этих метров на
   * рулоне физически не было.
   */
  usedQuantity?: number;
}

export type RollMovementKind =
  | 'order'
  | 'defect'
  | 'return_to_supplier'
  | 'workshop_writeoff'
  /** Закройщик закрыл рулон на терминале: остаток списан, зафиксирована недостача. */
  | 'close';

/** Этап выполнения заказа: кто раскроил / сшил / упаковал. */
export interface RollOrderStage {
  role: 'cutter' | 'sewer' | 'packer';
  label: string;
  userName: string | null;
  at: string | null;
}

export interface RollMovement {
  kind: RollMovementKind;
  quantity: number;
  createdAt: string;
  orderNumber: string | null;
  userName: string | null;
  comment: string | null;
  /** Лесенка этапов заказа (только для движений kind='order'). */
  stages?: RollOrderStage[] | null;
  /** Кто отвечает за брак этого материала: Тюль — закройщик, Аксессуары — швея,
   * Упаковка — упаковщик. Для незнакомого типа материала — null. */
  defectRole?: 'cutter' | 'sewer' | 'packer' | null;
  defectRoleLabel?: string | null;
}

/** Рулон в деталях: тип материала нужен, чтобы правильно назвать ответственного за брак. */
export interface RollDetailInfo extends Roll {
  materialType: string | null;
  kind: 'fabric' | 'trim';
  defectRole?: 'cutter' | 'sewer' | 'packer' | null;
  defectRoleLabel?: string | null;
  /** Себестоимость рулона — видит только администратор. */
  supplierName?: string | null;
  shipmentId?: number | null;
  /** Цена за единицу в валюте поставщика на момент приёмки. */
  purchasePrice?: number | null;
  purchaseCurrency?: string | null;
  /** Курс валюты, по которому приняли (у рублёвых позиций — 1). */
  purchaseRate?: number | null;
  /** Логистика, пришедшаяся на единицу. */
  logisticsPerUnit?: number | null;
  /** Итог: сколько стоит 1 пог.м. или 1 шт в рублях. */
  costPerUnit?: number | null;
}

export interface RollDetail {
  roll: RollDetailInfo;
  history: RollMovement[];
  /** Сколько расхода подтверждено историей движений. */
  trackedQuantity?: number;
  /** Расход без записей — данные перенесены из старой системы. */
  untrackedQuantity?: number;
}

/** Стоимость остатков одного материала на складе и в цехах. */
export interface StockValueMaterial {
  materialId: number;
  material: string;
  unit: string;
  materialType: string | null;
  /** Остаток в метрах или штуках. */
  remaining: number;
  /** Во сколько этот остаток обошёлся, ₽. */
  value: number;
  /** Всего рулонов с остатком: склад и цех вместе. */
  rolls: number;
  /** Рулоны без себестоимости — их стоимость в сумму не вошла. */
  rollsWithoutCost: number;
  inStorage: number;
  inWorkshop: number;
  /** Сколько рулонов физически лежит на складе. */
  rollsInStorage: number;
  /** Сколько рулонов сейчас в цехах. */
  rollsInWorkshop: number;
}

export interface StockValue {
  byMaterial: StockValueMaterial[];
  totalValue: number;
  rollsWithoutCost: number;
}

/** Сколько денег лежит в остатках материалов. Только для администратора. */
export const fetchStockValue = async (): Promise<StockValue> => {
  const res = await fetch(`${ROLLS_URL}?stock_value=1`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось посчитать стоимость склада');
  return data as StockValue;
};

export const fetchRollDetail = async (id: number): Promise<RollDetail> => {
  const res = await fetch(`${ROLLS_URL}?id=${id}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Рулон не найден');
  }
  return data as RollDetail;
};

export const fetchRolls = async (filters?: {
  materialId?: number;
  status?: string;
  /** Отметить рулоны, по которым было движение в текущей смене этого сотрудника. */
  usedSinceUserId?: number;
  /** Производственная роль: вернуть рулоны ТОЛЬКО цеха её открытой смены. */
  forUserId?: number;
  /** В какой должности человек работает ПРЯМО СЕЙЧАС — от неё зависит материал:
   * швея берёт тесьму, закройщик тюль. У совместителей роль в открытой смене
   * может не совпадать с выбранной в приложении, и без этого швея-совместитель
   * видела список рулонов закройщика. */
  forRole?: string;
  /** Поиск по штрихкоду. Ищется в базе: список ограничен свежими рулонами,
   * и закрытый рулон полугодовой давности иначе не нашёлся бы. */
  search?: string;
}): Promise<Roll[]> => {
  const params = new URLSearchParams();
  if (filters?.materialId) params.set('material_id', String(filters.materialId));
  if (filters?.status) params.set('status', filters.status);
  if (filters?.usedSinceUserId) params.set('usedSinceUserId', String(filters.usedSinceUserId));
  if (filters?.forUserId) params.set('forUserId', String(filters.forUserId));
  if (filters?.forRole) params.set('forRole', filters.forRole);
  if (filters?.search) params.set('search', filters.search);
  const qs = params.toString();
  const res = await fetch(qs ? `${ROLLS_URL}?${qs}` : ROLLS_URL);
  const data = await res.json();
  return data.rolls || [];
};

/** Один кусок ткани, возвращённый упаковщицей и ещё не пущенный в раскрой. */
export interface PackerPiece {
  quantity: number;
  returnedAt: string;
}

/**
 * Рулон не закрыть: в цехе лежит невыкроенный материал от упаковщицы.
 *
 * Отдельная ошибка, потому что закройщице нужен не текст, а список: сколько кусков
 * искать и какого размера. Терминал показывает это крупной карточкой.
 */
export class PackerPiecesError extends Error {
  constructor(
    message: string,
    public readonly total: number,
    public readonly pieces: PackerPiece[],
    public readonly unit: string,
  ) {
    super(message);
    this.name = 'PackerPiecesError';
  }
}

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(ROLLS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    // Невыкроенные куски от упаковщицы: пробрасываем их списком, чтобы терминал
    // показал закройщице, что именно искать в цехе.
    if (data.packerPieces) {
      throw new PackerPiecesError(
        data.error || 'В цехе есть материал от упаковщицы',
        data.packerReturned || 0,
        data.packerPieces,
        data.unit || 'м',
      );
    }
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

/** Ручное создание рулона — только для администратора: обычный приход оформляется
 * приёмкой от поставщика, где у партии есть документ, поставщик и цена. */
export const createRoll = (payload: {
  barcode: string;
  materialId: number;
  initialQuantity: number;
  workshopId?: number;
  shiftNumber?: number;
  actorRole?: string;
}) => postAction({ action: 'create', ...payload });

export const updateRoll = (
  id: number,
  fields: Partial<{ status: RollStatus; workshopId: number | null; shiftNumber: number | null }>
) => postAction({ action: 'update', id, ...fields });

/**
 * Ручное списание метража с рулона — когда материал уходит не в пошив.
 *
 * Продали знакомому, отрезали образец, испортили при перемотке. Без такого
 * списания остаток в системе расходился бы с тем, что реально на полке.
 * Доступно только администратору, причина обязательна: расход попадает в
 * журнал движений материала и в историю действий.
 */
export const writeOffRoll = (
  id: number,
  quantity: number,
  opts?: { orderId?: number; actorId?: number; reason?: string },
) =>
  postAction({
    action: 'write_off',
    id,
    quantity,
    orderId: opts?.orderId,
    actorId: opts?.actorId,
    reason: opts?.reason,
  }) as Promise<{ success: true; remainingQuantity: number }>;

/**
 * Переместить рулон: вернуть на склад или отдать цеху/другой смене.
 *
 * Рулон уехал в цех, а там не нужен — смену закрыли, заказ отменили, ткань не
 * подошла. Или наоборот: материал нужен соседней смене, и гонять рулон через
 * склад ради смены цифры в системе глупо — ткань лежит в том же цехе.
 *
 * Только для администратора, причина обязательна: перемещение материала должно
 * оставлять именной след в журнале.
 */
export const moveRoll = (payload: {
  id: number;
  target: 'storage' | 'workshop';
  reason: string;
  workshopId?: number;
  shiftNumber?: number;
}) =>
  postAction({ action: 'move_roll', ...payload }) as Promise<{
    success: true;
    status: 'in_storage' | 'in_workshop';
    /** Рулон уехал в другой цех — там его должны принять в руки. */
    needsAccept?: boolean;
  }>;

/**
 * Упаковщица возвращает годный кусок материала на рулон.
 *
 * При перепаковке иногда нужен перекрой, и на руках остаётся целый кусок.
 * Вместо утилизации он возвращается на рулон и кроится дальше.
 *
 * Такой метраж числится ОТДЕЛЬНО от основного: в расчёт штрафа за недостачу он
 * не входит, иначе закройщица получила бы удержание за чужой материал.
 */
/**
 * Рулоны, на которые можно вернуть кусок от этой вещи.
 *
 * Отбор делает сервер: тот же материал, цех и смена упаковщицы. Заодно
 * присылает готовый метраж — ширина вещи в погонных метрах, руками вводить
 * ничего не нужно.
 */
export const fetchSuitableRolls = (payload: {
  goodsWarehouseId: number;
  userId?: number;
}) =>
  postAction({ action: 'suitable_rolls', ...payload }) as Promise<{
    rolls: {
      id: number;
      barcode: string;
      materialName: string | null;
      remainingQuantity: number;
      unit: string | null;
    }[];
    material: string | null;
    width: number | null;
    quantity: number | null;
  }>;

export const packerReturnToRoll = (payload: {
  barcode?: string;
  rollId?: number;
  /** Не передаём — сервер посчитает сам по ширине вещи. */
  quantity?: number;
  goodsWarehouseId?: number;
  userId?: number;
  userName?: string;
  note?: string;
}) =>
  postAction({ action: 'packer_return', ...payload }) as Promise<{
    success: true;
    rollId: number;
    barcode: string;
    materialName: string | null;
    unit: string | null;
    added: number;
    remainingQuantity: number;
    packerReturnedQuantity: number;
  }>;

export const deleteRoll = (id: number) => postAction({ action: 'delete', id });

/**
 * Приёмка рулона сменой.
 *
 * Кладовщик отгрузил рулон в цех — материал становится доступен для заказов только
 * после того, как сотрудник подтвердит, что рулон реально у него в руках. До этого
 * рулон числится «в пути» и в работу не идёт.
 */
export const acceptRoll = (id: number, userId?: number, userName?: string) =>
  postAction({ action: 'accept', id, userId, actorName: userName });

/** Закрытие рулона в цехе: рулон закончился. Если ткани не хватило — передаётся недостача. */
export const closeRoll = (id: number, shortage = 0, userId?: number, userName?: string) =>
  postAction({ action: 'close_roll', id, shortage, userId, userName });

/** Сводка недостач по закрытым рулонам: средний процент по каждой ткани, разрез по
 * закройщикам и список рулонов. Пока используется только для сбора статистики. */
export interface ShortageByMaterial {
  materialId: number;
  material: string;
  unit: string;
  cost: number;
  normPercent: number | null;
  rollsClosed: number;
  shortageTotal: number;
  avgPercent: number;
  maxPercent: number;
  rollsWithShortage: number;
  costTotal: number;
}

export interface ShortageByUser {
  userId: number | null;
  userName: string;
  rollsClosed: number;
  shortageTotal: number;
  avgPercent: number;
  costTotal: number;
}

export interface ShortageRoll {
  id: number;
  barcode: string;
  material: string;
  unit: string;
  initialQuantity: number;
  shortage: number;
  shortagePercent: number;
  closedBy: string;
  completedAt: string | null;
  cost: number;
  /**
   * Что вписала сотрудница руками на терминале.
   *
   * Недостачей считается фактический остаток при закрытии (поле shortage), а это
   * — её пояснение: сколько, по её мнению, недомотал поставщик. Обычно там ноль:
   * поле просто не заполняют. Показываем для сверки.
   */
  declaredShortage: number;
  /**
   * Решение администратора по рулону.
   *
   * null — ещё не разбирал, 0 — списал на поставщика (денег не удержал),
   * больше нуля — удержал с сотрудницы. Списание на поставщика снимает деньги,
   * но НЕ отменяет факт недостачи: метры всё равно не ушли в изделия.
   */
  penaltyTotal: number | null;
}

/**
 * Сигнал по сотруднику — то, ради чего отчёт и делался.
 *
 * Система сама ищет закономерности, которые глазами в таблице не выцепить:
 * брак не оформляют вовсе, списывают полотном вместо обрезков, недостача
 * кратно выше, чем у коллег на той же работе.
 */
export interface MaterialSignal {
  kind: 'no_defects' | 'big_pieces' | 'rare_big' | 'shortage_high';
  text: string;
}

/** Строка сотрудника в анализе сырья: недостача и брак рядом. */
export interface MaterialPerson {
  userId?: number;
  userName: string;
  role: string | null;
  shifts: number;
  rollsClosed: number;
  shortageQty: number;
  shortagePercent: number;
  shortageMoney: number;
  /** Сколько рулонов админ списал на поставщика: деньги не удержаны. */
  forgivenRolls: number;
  defectCount: number;
  defectQty: number;
  defectAvgPiece: number;
  defectMaxPiece: number;
  /** Списаний кусками от 5 — это уже не обрезки. */
  bigPieces: number;
  defectMoney: number;
  defectDays: number;
  signals: MaterialSignal[];
}

/** Материал: где теряем больше всего — и на недостаче, и на браке. */
export interface MaterialLossRow {
  materialId: number;
  material: string;
  unit: string;
  rollsClosed: number;
  shortageQty: number;
  shortagePercent: number;
  shortageMoney: number;
  defectQty: number;
  defectMoney: number;
}

/** День, когда у человека брака кратно больше его обычного. */
export interface MaterialSpike {
  userName: string;
  date: string;
  count: number;
  quantity: number;
  maxPiece: number;
}

export interface MaterialAnalysis {
  people: MaterialPerson[];
  byMaterial: MaterialLossRow[];
  spikes: MaterialSpike[];
  totals: {
    shortageQty: number;
    shortageMoney: number;
    defectQty: number;
    defectMoney: number;
    rollsClosed: number;
    signalsCount: number;
  };
}

/**
 * Анализ сырья: недостачи и брак в одном отчёте.
 *
 * Раньше это были две страницы, и связать их глазами было невозможно. А связь
 * прямая: кто не оформляет брак — у того высокая недостача (обрезки ушли молча),
 * и наоборот. По отдельности обе картины выглядят нормально, вместе — видны.
 */
export const fetchMaterialAnalysis = async (params?: {
  from?: string;
  to?: string;
  role?: string;
  workshop?: string;
}): Promise<MaterialAnalysis> => {
  const qs = new URLSearchParams({ material_analysis: '1' });
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.role) qs.set('role', params.role);
  if (params?.workshop) qs.set('workshop', params.workshop);
  const res = await fetch(`${ROLLS_URL}?${qs.toString()}`);
  if (!res.ok) throw new Error('Не удалось загрузить анализ сырья');
  const data = await res.json();
  return {
    people: data.people || [],
    byMaterial: data.byMaterial || [],
    spikes: data.spikes || [],
    totals: data.totals || {
      shortageQty: 0,
      shortageMoney: 0,
      defectQty: 0,
      defectMoney: 0,
      rollsClosed: 0,
      signalsCount: 0,
    },
  };
};

export const fetchShortageStats = async (params?: {
  from?: string;
  to?: string;
}): Promise<{
  byMaterial: ShortageByMaterial[];
  byUser: ShortageByUser[];
  rolls: ShortageRoll[];
}> => {
  const qs = new URLSearchParams({ shortage_stats: '1' });
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  const res = await fetch(`${ROLLS_URL}?${qs.toString()}`);
  const data = await res.json();
  return { byMaterial: data.byMaterial || [], byUser: data.byUser || [], rolls: data.rolls || [] };
};
/** Закрытый рулон с недостачей, ожидающий решения администратора. */
export interface PendingPenalty {
  rollId: number;
  barcode: string;
  materialName: string;
  unit: string;
  initialQuantity: number;
  /** Недостача, по которой считаются деньги: весь метраж, не ушедший в изделия. */
  shortage: number;
  /** Что сотрудница вписала руками при закрытии — для сверки с фактом. */
  declaredShortage?: number;
  normPercent: number | null;
  costPerUnit: number;
  /** Допустимая недостача в единицах — сколько прощается по норме поставщика. */
  allowed?: number;
  /** Метраж сверх нормы, за который начисляется штраф. */
  excess: number;
  /** Сумма удержания по рулону. */
  total: number;
  /** Сколько снимут с каждого. */
  perUser?: number;
  /** Кого коснётся: «Швеи» для тесьмы, «Закройщицы» для ткани. */
  role?: string;
  users: Array<{
    id: number;
    name: string;
    amount: number;
    /** Сколько метража с этого рулона ушло в изделия этого сотрудника. */
    usedQuantity?: number;
    /** По скольким заказам он брал материал с рулона. */
    ordersCount?: number;
  }>;
  /** Почему штраф начислить нельзя. Пусто — можно начислять. */
  reason: string | null;
  /** Кто закрыл рулон в цехе. */
  closedByName?: string | null;
  /** Сколько метража числилось на рулоне в момент закрытия — им перепроверяют недостачу. */
  remainingAtClose?: number | null;
  /** Когда рулон закрыли. */
  closedAt?: string | null;
}

/** Рулоны с недостачей, по которым решение ещё не принято. */
export const fetchPendingPenalties = async (): Promise<PendingPenalty[]> => {
  const res = await fetch(`${ROLLS_URL}?shortage_pending=1`);
  const data = await res.json();
  return data.items || [];
};

/** Удержать деньги с сотрудников за недостачу сверх нормы. */
export const chargePenalty = async (rollId: number) => {
  const res = await fetch(ROLLS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'charge_penalty', id: rollId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось начислить штраф');
  return data;
};

/** Признать недостачу виной поставщика и никого не штрафовать. */
export const dismissPenalty = async (rollId: number) => {
  const res = await fetch(ROLLS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dismiss_penalty', id: rollId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось выполнить');
  return data;
};

/** Закройщик отставил рулон: брак в начале полотна, резать дальше нельзя. */
export const flagRollDefect = async (id: number, reason: string, actorId?: number, actorName?: string) => {
  const res = await fetch(ROLLS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'flag_defect', id, reason, actorId, actorName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось отметить рулон');
  return data;
};

/** Кладовщик забирает бракованный рулон из цеха — сканированием штрихкода рулона. */
export const receiveDefectRoll = async (
  barcode: string,
  actorId?: number,
  actorName?: string,
): Promise<{
  barcode: string;
  materialName: string;
  remaining: number;
  unit: string | null;
  reason: string | null;
  flaggedBy: string | null;
}> => {
  const res = await fetch(ROLLS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'receive_defect_roll', barcode, actorId, actorName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось забрать рулон');
  return data;
};

/** Брак не подтвердился — рулон возвращается в работу. */
export const declineDefectRoll = async (id: number, reason: string, actorId?: number) => {
  const res = await fetch(ROLLS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'decline_defect_roll', id, reason, actorId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось отклонить');
  return data;
};
/** Строка анализа: одна закройщица на одной смене. */
export interface CutterAnalysisRow {
  userId: number;
  name: string;
  shiftNumber: number | null;
  /** Рулонов, которые она вела одна от начала до конца. */
  rollsTotal: number;
  /** Сколько метража с них не ушло в изделия. */
  lostQuantity: number;
  initialQuantity: number;
  /** Из них рулонов с превышением нормы поставщика. */
  overNormRolls: number;
  /** Деньги сверх нормы — включая рулоны, прощённые администратором. */
  overNormMoney: number;
  /** Сколько рулонов админ списал на поставщика. */
  forgivenRolls: number;
  /** Доля рулонов с превышением нормы, %. */
  overNormShare: number;
}

/** Рулон в детализации по закройщице. */
export interface CutterRollRow {
  rollId: number;
  barcode: string;
  materialName: string;
  shiftNumber: number | null;
  initialQuantity: number;
  lostQuantity: number;
  declaredShortage: number;
  normPercent: number | null;
  allowed: number | null;
  excess: number;
  money: number;
  penaltyTotal: number | null;
  closedAt: string | null;
  unit: string;
  supplierName: string | null;
}

/** Анализ недостач по закройщицам: только рулоны, которые вели в одиночку. */
export const fetchCutterAnalysis = async (): Promise<CutterAnalysisRow[]> => {
  const res = await fetch(`${ROLLS_URL}?cutter_analysis=1`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить анализ');
  return data.items || [];
};

/** Рулоны конкретной закройщицы — раскрытие строки анализа. */
export const fetchCutterRolls = async (userId: number): Promise<CutterRollRow[]> => {
  const res = await fetch(`${ROLLS_URL}?cutter_rolls=${userId}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить рулоны');
  return data.items || [];
};