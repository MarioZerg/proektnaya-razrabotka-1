const KIOSK_URL = 'https://functions.poehali.dev/646f604e-57e9-47fb-b2ca-dd424abfba48';

export interface KioskOrder {
  id: number;
  orderNumber: string;
  product: string;
  material: string | null;
  width: number | null;
  height: number | null;
  sewingStatus: string;
  assignedUserId: number | null;
  assignedUserName: string | null;
  /** Клиент отменил заказ: вещь дошивается, но уходит не покупателю, а на склад хранения —
   * упаковщик клеит стикер ХРАНЕНИЯ вместо стикера отправления. */
  isCancelled?: boolean;
  /** Отправление уже уехало к покупателю (или снято маркетплейсом) — ярлык не выдадут.
   * Вещь закрывают со стикером хранения и кладут на полку, как отменённую. */
  labelGone?: boolean;
  marketplace?: string | null;
  /** Заказ покупателя из нескольких вещей (Яндекс Маркет). Ярлык на такой заказ один общий,
   * поэтому вещи упаковываются вместе — терминал предупреждает об этом упаковщицу. */
  groupKey?: string | null;
  groupSize?: number | null;
  groupPosition?: number | null;
  /** Покупатель — юридическое лицо (B2B с OZON). Терминал показывает пометку. */
  isLegalEntity?: boolean;
  legalCompanyName?: string | null;
  /** FBS — ярлык отправления выдаёт маркетплейс по API; FBO — печатаем свой стикер товара. */
  orderType?: string | null;
  /** Кластер FBO — город назначения поставки. Упаковщица видит, куда уедет вещь. */
  cluster?: string | null;
  /** Кто кроил эту вещь. */
  cutterName?: string | null;
  /** Кто шил эту вещь. */
  sewerName?: string | null;
}

/** Заказ уже закрыт, но вещь физически осталась у упаковщицы: её можно сдать на склад
 * как свободный остаток. Так бывает, когда заказ закрыли вещью с полки (подбор), а швея
 * тем временем дошила свою — покупателю она уже не поедет. */
export class SpareItemError extends Error {
  order: Pick<
    KioskOrder,
    'id' | 'orderNumber' | 'product' | 'material' | 'width' | 'height' | 'sewingStatus'
  >;

  constructor(message: string, order: SpareItemError['order']) {
    super(message);
    this.name = 'SpareItemError';
    this.order = order;
  }
}

export const fetchKioskOrder = async (orderNumber: string): Promise<KioskOrder> => {
  const res = await fetch(`${KIOSK_URL}?orderNumber=${encodeURIComponent(orderNumber)}`);
  const data = await res.json();
  if (!res.ok) {
    if (data.canStoreSpare && data.order) {
      throw new SpareItemError(data.error || 'Заказ уже закрыт', data.order);
    }
    throw new Error(data.error || 'Заказ не найден');
  }
  return data.order;
};

/** Сдать на склад вещь по уже закрытому заказу: заводит складской штрихкод, по которому
 * кладовщик положит её на полку как свободный остаток. */
/**
 * Подтвердить, что стикер хранения напечатан и наклеен на вещь.
 *
 * Только после этого вещь встаёт в очередь «Разложить по полкам» у кладовщика. Раньше
 * она попадала туда сразу при закрытии заказа — кладовщик видел счётчик, шёл в цех,
 * а вещей там не было: печать могла не сработать и вещь оставалась у упаковщицы.
 */
export const confirmStorageLabelPrinted = async (storageBarcode: string): Promise<void> => {
  await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'storage_label_printed', storageBarcode }),
  });
};

export const storeSpareItem = async (
  orderId: number,
  actorId?: number,
  actorName?: string
): Promise<{
  success: true;
  storageBarcode: string;
  orderNumber: string;
  product: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
}> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'store_spare', orderId, actorId, actorName }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

/** Ручной поиск заказов на стикеровке, когда сканер не работает или штрихкод не читается.
 * Ищет по размеру, материалу и швее — упаковщик выбирает нужный заказ из списка. */
/** Настройки цеха, влияющие на вид терминала. */
export interface KioskTerminalSettings {
  /** Показывать ли ручной поиск заказа (обход сканера). */
  manualStickering: boolean;
  /** Может ли швея упаковывать сама после закрытия смены упаковщицей. */
  sewerPackingAfterPackerShift: boolean;
}

export const fetchTerminalSettings = async (
  workshopId?: number | null
): Promise<KioskTerminalSettings> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'terminal_settings', workshopId }),
  });
  if (!res.ok) return { manualStickering: false, sewerPackingAfterPackerShift: false };
  return res.json();
};

export const findStickeringOrders = async (filters: {
  sewerId?: number | null;
  width?: number | null;
  height?: number | null;
  material?: string | null;
  workshopId?: number | null;
  /** Роль сотрудника — по ней сервер проверяет, разрешена ли ему стикеровка в этом цехе. */
  role?: string | null;
}): Promise<KioskOrder[]> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'find_stickering', ...filters }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось найти заказы');
  return data.orders || [];
};

/** Вещь на перепаковке: вернулась от покупателя годной, но с помятой упаковкой. */
export interface RepackItem {
  id: number;
  storageBarcode: string;
  orderNumber: string | null;
  product: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  returnReason: string | null;
  marketplace: string | null;
  /** true — вещь уже закреплена за этим цехом (её здесь отсканировали). */
  mine?: boolean;
}

/** Сколько вещей ждёт перепаковки в цехе — число для плитки в меню киоска. */
export const fetchRepackCount = async (
  workshopId?: number | null,
): Promise<{ mineCount: number; freeCount: number }> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'repack_count', workshopId }),
  });
  const data = await res.json();
  if (!res.ok) return { mineCount: 0, freeCount: 0 };
  return { mineCount: data.mineCount || 0, freeCount: data.freeCount || 0 };
};

/**
 * Скан вещи на перепаковку по стикеру хранения.
 *
 * Сканировать быстрее и надёжнее, чем искать строку глазами в списке из сотни
 * позиций. Скан заодно закрепляет вещь за цехом: у соседнего киоска она из списка
 * пропадает, и одну вещь не переупакуют дважды.
 */
export const scanRepackItem = async (
  barcode: string,
  workshopId?: number | null,
): Promise<RepackItem> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'repack_scan', barcode, workshopId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось отсканировать вещь');
  return data.item;
};

/** Решение упаковщика по вещи на перепаковке:
 *  repacked — переупакована, печатается стикер хранения и вещь уходит на склад;
 *  utilized — при вскрытии обнаружен брак, вещь списывается (нужна причина). */
export const finishRepack = async (payload: {
  id: number;
  outcome: 'repacked' | 'utilized';
  /** Брала ли упаковщица новый пакет — обязательно при успешной перепаковке. */
  newBag?: boolean;
  note?: string;
  actorId?: number;
  actorName?: string;
  /** Цех киоска — чтобы нельзя было закрыть вещь, которую взял соседний цех. */
  workshopId?: number | null;
}): Promise<{
  outcome: string;
  storageBarcode: string | null;
  newBag?: boolean;
  accrued?: number;
  /** Причина списания — печатается на стикере брака, чтобы вещь не перепутали. */
  disposeReason?: string | null;
}> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'repack_done', ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось завершить перепаковку');
  return data;
};

export interface KioskUser {
  id: number;
  name: string;
  role: string;
  shiftFromCode: number | null;
  /** Штатный цех сотрудника из профиля — в чужом цехе списание брака ему недоступно. */
  homeWorkshopId?: number | null;
  /**
   * Должности, разрешённые сотруднику администратором.
   *
   * Многие в цехе совмещают: числится закройщиком, а сегодня шьёт. От должности смены
   * зависит, какой материал показывает терминал (закройщику — ткань, швее — тесьму),
   * поэтому при нескольких разрешённых должностях спрашиваем, кем человек работает.
   */
  allowedRoles?: string[];
}

export interface KioskShift {
  isOpen: boolean;
  openedAt: string | null;
  workshopId: number | null;
  shiftNumber: number | null;
  /**
   * Во сколько сотрудник сможет закрыть смену. Считается от фактического прихода:
   * пришёл в 7:14 при графике 07:00-19:00 — закроет в 19:14. До этого времени
   * кнопка закрытия неактивна, раньше смену закрывает только администратор.
   */
  canCloseAt: string | null;
  /** Роль ИМЕННО этой смены: гость может работать в чужом цехе другой ролью. */
  role?: string | null;
}

/** Вход на терминал по личному QR-коду сотрудника (формат "{id}-{смена}-{дата}"). */
export const kioskLoginByCode = async (
  code: string
): Promise<{ user: KioskUser; shift: KioskShift }> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login_by_code', code }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Не удалось войти');
  }
  return data;
};

/** Списание брака на терминале: штатный сотрудник цеха сканирует свой штрихкод и списывает
 * метраж с рулона — в том числе за гостевых работников, которым это в чужом цехе запрещено. */
export const kioskDefectWriteoff = async (payload: {
  code: string;
  rollId: number;
  quantity: number;
  comment?: string;
}): Promise<{ success: true; id: number; actorName: string }> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'defect_writeoff', ...payload }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

export const closeKioskOrder = async (
  orderId: number,
  packerId: number,
  actorId?: number,
  actorName?: string,
  /** Ярлык отправления реально напечатан: вещь едет покупателю, а не на склад хранения.
   * Нужен для многовещевых посылок OZON, где отправление уже помечено уехавшим, но
   * ярлык на него всё ещё выдаётся — такую вещь докладывают в её же посылку. */
  labelPrinted?: boolean
): Promise<{
  success: true;
  isCancelled: boolean;
  /** Индивидуальный пошив — печатается свой стикер, вещь уходит на полку. */
  isIndividual?: boolean;
  storageBarcode: string | null;
  orderNumber?: string;
  material?: string | null;
  width?: number | null;
  height?: number | null;
  product?: string | null;
  /** Связка Яндекса: размер заказа и сколько вещей ещё не застикеровано. */
  groupSize?: number | null;
  groupPosition?: number | null;
  groupLeft?: number;
  /** Заказ уже был закрыт раньше — повторное нажатие просто закрывает окно. */
  alreadyClosed?: boolean;
}> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'close_order', orderId, packerId, actorId, actorName, labelPrinted,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};
export interface UnlabeledCandidate {
  id: number;
  storageBarcode: string;
  orderNumber: string;
  product: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  sewerName: string | null;
  packerName: string | null;
  marketplace: string | null;
  receivedAt: string | null;
}

/** Кладовщик ищет вещь без стикера хранения среди отменённых заказов, ждущих укладки на
 * полку — по швее и/или размеру. Нужен, когда упаковщица не наклеила стикер или он потерян. */
export const findUnlabeledGoods = async (filters: {
  sewerId?: number;
  width?: number;
  height?: number;
}): Promise<UnlabeledCandidate[]> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'find_unlabeled', ...filters }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка поиска');
  }
  return data.candidates || [];
};

/** Швеи, у которых сейчас есть вещи на стикеровке — для выбора в ручном поиске. */
export const fetchStickeringSewers = async (
  workshopId?: number | null
): Promise<Array<{ id: number; name: string; count: number }>> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'stickering_sewers', workshopId }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data.sewers || [];
};

/** Швеи, у которых есть вещи, ожидающие укладки на полку. */
export const fetchUnlabeledSewers = async (): Promise<Array<{ id: number; name: string }>> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sewers_list' }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data.sewers || [];
};

/** Фиксирует факт перепечатки стикера хранения — для отчёта админу, кто пропускает стикеры. */
export const reprintStorageLabel = async (
  goodsId: number,
  actorId?: number,
  actorName?: string
): Promise<void> => {
  await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reprint_label', goodsId, actorId, actorName }),
  });
};

export interface ReprintReport {
  total: number;
  days: number;
  byPacker: Array<{ packerName: string; count: number; lastAt: string | null }>;
  events: Array<{
    createdAt: string;
    actorName: string | null;
    orderNumber: string | null;
    product: string | null;
    packerName: string | null;
    sewerName: string | null;
  }>;
}

/** Отчёт: сколько стикеров хранения перепечатано и по чьей вине. */
export const fetchReprintReport = async (days = 30): Promise<ReprintReport> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reprint_report', days }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

// ---------- Брак материалов ----------

export interface DefectReason {
  code: string;
  label: string;
}

export interface DefectRoll {
  id: number;
  barcode: string;
  materialName: string;
  unit: string | null;
  /** «Тюль» (ткань), «Аксессуары» (тесьма) или «Упаковка» (пакеты и этикетки) —
   * от типа зависят причины брака. */
  materialType: string;
  remaining: number;
  reasons: DefectReason[];
}

/** Цех, куда сотрудник может выйти сегодня, и его активные смены. */
export interface OpenShiftWorkshop {
  id: number;
  name: string;
  shifts: number[];
}

/** Активные цеха и смены — из чего сотрудник выбирает при открытии смены на терминале.
 * Производственные роли работают гибко и могут выйти в любой цех, а не только в свой. */
export const fetchOpenShiftOptions = async (): Promise<OpenShiftWorkshop[]> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'open_shift_options' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить цеха');
  return data.workshops || [];
};

/** Рулоны цеха, по которым можно оформить брак, вместе с подходящими причинами.
 * Пакеты и этикетки сюда не попадают — по ним брак не ведут. */
export const fetchDefectRolls = async (
  workshopId?: number,
  /** Должность сотрудника: упаковщице отдаём пакеты и этикетки, швее и закройщику —
   * ткань и тесьму. Без роли вернутся все материалы. */
  role?: string
): Promise<DefectRoll[]> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'defect_reasons', workshopId, role }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить рулоны');
  return data.rolls || [];
};

/** Рулон, найденный сканером на экране брака. */
export interface ScannedDefectRoll {
  id: number;
  barcode: string;
  materialName: string;
  materialType: string;
  unit: string | null;
  remaining: number;
  shiftNumber: number | null;
  reasons: Array<{ code: string; label: string }>;
}

/**
 * Найти рулон по отсканированному штрихкоду для списания брака.
 *
 * Сервер сам проверяет правила: рулон должен лежать в цехе открытой смены сотрудника,
 * быть из ЕГО смены и подходить его роли (закройщику — тюль, швее — тесьма,
 * упаковщице — упаковка). Иначе вернётся понятная ошибка.
 */
export const scanDefectRoll = async (
  barcode: string,
  userId: number
): Promise<ScannedDefectRoll> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'defect_scan_roll', barcode, userId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Рулон не найден');
  return data;
};

export interface DefectResult {
  defectId: number;
  /** Штрихкод стикера брака DF-000001 — печатается и клеится на бракованный кусок. */
  defectBarcode: string;
  reasonLabel: string;
  materialType: string;
  unit: string | null;
  actorName: string;
  /** ID сотрудника — печатается на стикере вместо фамилии. */
  actorId: number;
}

/** Оформить брак рулона на терминале. */
export const createDefect = async (payload: {
  /** Штрихкод другого сотрудника — когда брак за гостя оформляет штатный работник цеха. */
  code?: string;
  /** Сотрудник, уже вошедший на терминале: свой штрихкод сканировать повторно не нужно. */
  userId?: number;
  rollId: number;
  quantity: number;
  reasonCode: string;
  comment?: string;
}): Promise<DefectResult> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'defect_writeoff', ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось оформить брак');
  return data;
};

/** Кладовщик принимает брак на склад по стикеру из контейнера. */
export const receiveDefect = async (
  barcode: string,
  actorId?: number,
  actorName?: string
): Promise<{
  barcode: string;
  materialName: string;
  quantity: number;
  unit: string | null;
  reasonLabel: string;
  foundBy: string;
}> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'defect_receive', barcode, actorId, actorName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось принять брак');
  return data;
};

export interface PendingDefect {
  barcode: string;
  materialName: string;
  unit: string | null;
  quantity: number;
  reasonLabel: string;
  userName: string;
  workshopName: string | null;
  createdAt: string;
  /** Кто нашёл брак: закройщик, швея или упаковщица. */
  userRole: string | null;
  /** Рулон, из которого вырезан кусок, и его поставщик. */
  rollBarcode: string | null;
  supplierName: string | null;
  comment: string | null;
  /** Кусок от 2 пог.м — крупный, осматриваем тщательно. */
  isLarge: boolean;
}

/** Принятый брак: по нему собирается статистика по рулонам и поставщикам. */
export interface DefectHistoryRow {
  barcode: string;
  materialName: string;
  unit: string | null;
  quantity: number;
  reasonLabel: string;
  userName: string;
  userRole: string | null;
  rollBarcode: string | null;
  supplierName: string | null;
  receivedAt: string | null;
  receivedByName: string | null;
  comment: string | null;
}

export const fetchDefectHistory = async (days = 30): Promise<DefectHistoryRow[]> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'defect_history', days }),
  });
  const data = await res.json();
  return data.items || [];
};

/** Брак, который ещё лежит в контейнерах и не доехал до склада. */
export const fetchPendingDefects = async (): Promise<PendingDefect[]> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'defect_pending' }),
  });
  const data = await res.json();
  return data.items || [];
};

export interface DefectReportRow {
  month: string;
  userName: string;
  role: string;
  count: number;
  quantity: number;
  pending: number;
}

export interface DefectReport {
  byUser: DefectReportRow[];
  byReason: { reason: string; count: number; quantity: number }[];
  /** Сотрудники, не оформившие ни одного брака — их проверяют в первую очередь. */
  neverReported: { userName: string; role: string }[];
  pendingCount: number;
  pendingQuantity: number;
}

export const fetchDefectReport = async (months = 6): Promise<DefectReport> => {
  const res = await fetch(KIOSK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'defect_report', months }),
  });
  const data = await res.json();
  return {
    byUser: data.byUser || [],
    byReason: data.byReason || [],
    neverReported: data.neverReported || [],
    pendingCount: data.pendingCount || 0,
    pendingQuantity: data.pendingQuantity || 0,
  };
};

/** Сколько брака списал сотрудник за период. */
export interface DefectByUser {
  userId: number;
  userName: string;
  role: string;
  /** Сколько раз оформлял брак. */
  times: number;
  /** Общий метраж/количество. */
  quantity: number;
  /** Во сколько это обошлось по себестоимости рулонов. */
  costTotal: number;
  /** На скольких сменах оформлял брак. */
  shifts: number;
  /** Средний брак за смену — по нему видно, кто выбивается из общего ряда. */
  perShift: number;
  firstAt: string | null;
  lastAt: string | null;
}

export interface DefectByReason {
  reason: string;
  times: number;
  quantity: number;
  costTotal: number;
}

export interface DefectItem {
  barcode: string;
  createdAt: string | null;
  userName: string;
  role: string;
  materialName: string;
  unit: string;
  quantity: number;
  reason: string;
  comment: string;
  cost: number;
  workshop: string;
  received: boolean;
}

/** Статистика брака по сотрудникам: кто сколько списал за все смены. */
export const fetchDefectStats = async (params?: {
  from?: string;
  to?: string;
}): Promise<{
  byUser: DefectByUser[];
  byReason: DefectByReason[];
  items: DefectItem[];
}> => {
  const qs = new URLSearchParams({ defect_stats: '1' });
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  const res = await fetch(`${KIOSK_URL}?${qs.toString()}`);
  const data = await res.json();
  return { byUser: data.byUser || [], byReason: data.byReason || [], items: data.items || [] };
};