const REPAIR_FABRIC_URL = 'https://functions.poehali.dev/580fc69a-16df-4299-ae73-af0a840f29d1';

/**
 * POEHALI: куски на перешив. FRONTEND-ONLY: ошибка загрузки списка — только экран.
 */

/**
 * ПУТЬ КУСКА: available → reserved → used.
 *
 * available — лежит в цехе, доступен всем закройщицам;
 * reserved  — закреплён за конкретным заказом. Из общего списка исчез, но
 *             ткань ещё цела: кусок можно открепить, и он вернётся в перешив;
 * used      — разрезан при раскрое, вернуть нельзя;
 * written_off — списан администратором (брак, потеря).
 */
export type RepairPieceStatus = 'incoming' | 'available' | 'reserved' | 'used' | 'written_off';

/**
 * Причина, по которой вещь ушла в перешив.
 *
 * Список приходит с сервера, а не лежит в коде терминала: подпись на стикере,
 * запись в базе и текст, который видит закройщица в карточке заказа, обязаны
 * совпадать до буквы. Две копии списка рано или поздно разойдутся.
 */
export interface RepairReason {
  code: string;
  label: string;
  /** Куда смотреть: «Ткань», «Пошив», «Тесьма», «Размер», «Прочее». */
  group: string;
}

/** Кусок ткани на перешив — отрез с фиксированными размерами, лежащий в цехе. */
export interface RepairPiece {
  id: number;
  material: string;
  materialId?: number | null;
  width: number;
  height: number;
  status: RepairPieceStatus;
  workshopId?: number | null;
  workshopName?: string | null;
  shiftNumber?: number | null;
  createdByName?: string | null;
  createdAt: string;
  usedOrderId?: number | null;
  usedOrderNumber?: string | null;
  usedByName?: string | null;
  usedAt?: string | null;
  comment?: string | null;
  /**
   * Номер со стикера, который упаковщица наклеила на вещь: RS-000042.
   *
   * По нему закройщица берёт со стеллажа нужный отрез, не разворачивая
   * соседние: тот же номер стоит в карточке заказа.
   */
  barcode?: string | null;
  /** Что с куском не так — где закройщице искать брак перед раскроем. */
  reasonLabel?: string | null;
  /** Кто завёл кусок: упаковщица, кладовщик или администратор. */
  addedByRole?: 'packer' | 'storekeeper' | 'admin' | null;
  goodsWarehouseId?: number | null;
  /** Номер со стикера брака GW-… — тот же, что был у вещи. */
  storageBarcode?: string | null;
  /** Заказ, из которого получился кусок. */
  sourceOrderNumber?: string | null;
  receivedAt?: string | null;
  labeledAt?: string | null;
  shippedAt?: string | null;
  cutAt?: string | null;
  sewnAt?: string | null;
  packedAt?: string | null;
  disposeReason?: string | null;
  /** Закройщик попросил администратора удалить кусок — ждёт решения. */
  removalRequest?: RepairRemovalRequest | null;
  /** Насколько кусок больше заказа — только в подборе под заказ. */
  extraWidth?: number;
  extraHeight?: number;
}

export type RepairRemovalReason = 'sticker_mismatch' | 'defective';

export const REMOVAL_REASON_LABELS: Record<RepairRemovalReason, string> = {
  sticker_mismatch: 'Не соответствует стикеру',
  defective: 'Бракованный, не подходит',
};

export interface RepairRemovalRequest {
  reason: RepairRemovalReason;
  reasonLabel: string;
  comment?: string | null;
  byName?: string | null;
  at: string;
}

/** Вкладка списка: статус куска, вся история или просьбы на удаление. */
export type RepairPiecesTab = RepairPieceStatus | 'all' | 'removal';

export interface RepairPiecesResult {
  pieces: RepairPiece[];
  /** Сколько кусков закройщики просят удалить — уведомление администратору. */
  removalRequests: number;
  /** Сколько кусков каждого материала лежит в цехе. */
  summary: Array<{ material: string; count: number }>;
}

export interface SuitablePiecesResult {
  pieces: RepairPiece[];
  order: {
    orderNumber?: string;
    material: string | null;
    width: number | null;
    height: number | null;
  };
  note?: string;
}

const request = async (url: string, init?: RequestInit) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    throw new Error('Нет связи с сервером');
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (res.status >= 500 ? 'База занята' : 'Ошибка склада перешива'));
  return data;
};

const post = (payload: Record<string, unknown>) =>
  request(REPAIR_FABRIC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

/** Остатки кусков в цехе. status='all' — вся история, включая израсходованные. */
export const fetchRepairPieces = async (
  params: { status?: RepairPiecesTab; material?: string } = {},
): Promise<RepairPiecesResult> => {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.material) q.set('material', params.material);
  const data = await request(`${REPAIR_FABRIC_URL}?${q.toString()}`);
  return { ...data, removalRequests: data.removalRequests ?? 0 };
};

/**
 * Закройщик просит администратора удалить кусок: не соответствует стикеру
 * или бракованный. Сам кусок не удаляется — решает администратор.
 */
export const requestPieceRemoval = (
  pieceId: number,
  reason: RepairRemovalReason,
  comment?: string,
) => post({ action: 'request_removal', pieceId, reason, comment });

/** Администратор отказал в удалении — кусок остаётся в цехе. */
export const dismissPieceRemoval = (pieceId: number) =>
  post({ action: 'dismiss_removal', pieceId });

/**
 * Куски, которыми можно перешить конкретный заказ.
 *
 * Сервер отбирает только тот же материал и размер НЕ МЕНЬШЕ заказа: из куска
 * 300×255 штору 400×265 не сшить. Список отсортирован от наименее
 * расточительных — сверху куски, которые почти впритык.
 */
export const fetchSuitablePieces = (orderId: number): Promise<SuitablePiecesResult> =>
  request(`${REPAIR_FABRIC_URL}?action=suitable&orderId=${orderId}`);

/** Справочник причин перешива для терминала упаковщицы. */
export const fetchRepairReasons = (): Promise<{ reasons: RepairReason[] }> =>
  request(`${REPAIR_FABRIC_URL}?action=reasons`);

export interface SendToRepairResult {
  success: true;
  pieceId: number;
  material: string;
  width: number;
  height: number;
  /** Номер для стикера — терминал тут же печатает наклейку. */
  barcode: string;
  reasonLabel: string;
  orderNumber?: string | null;
}

/**
 * Упаковщица отправляет вещь в перешив.
 *
 * Рулон указывать не нужно: кусок сохраняет свои размеры и попадает
 * закройщикам как отдельный отрез.
 *
 * ПРИЧИНА ОБЯЗАТЕЛЬНА. Без неё закройщица получает безымянный отрез и ищет
 * дефект, разворачивая всё полотно на столе, — самая долгая часть перекроя.
 * В ответ приходит номер стикера: его печатают и клеят на вещь.
 */
export const sendToRepair = (
  goodsWarehouseId: number,
  reason: { code?: string; label?: string },
  actor?: { id?: number | null; name?: string | null },
  barcode?: string,
): Promise<SendToRepairResult> =>
  post({
    action: 'send',
    goodsWarehouseId,
    barcode,
    reasonCode: reason.code,
    reasonLabel: reason.label,
    userId: actor?.id,
    userName: actor?.name,
  }) as Promise<SendToRepairResult>;

/** Кладовщик сканирует стикер: либо кусок RS ждёт приёмки в цех, либо брак GW. */
export const lookupRepairItem = (barcode: string) =>
  request(`${REPAIR_FABRIC_URL}?action=lookup&barcode=${encodeURIComponent(barcode)}`) as Promise<{
    item: {
      id: number;
      status: string;
      storageBarcode: string;
      material: string | null;
      width: number | null;
      height: number | null;
      orderNumber: string | null;
      disposeReason: string | null;
      canSend: boolean;
    } | null;
    incoming?: {
      pieceId: number;
      barcode: string;
      material: string | null;
      width: number | null;
      height: number | null;
      reasonLabel: string | null;
      orderNumber: string | null;
    } | null;
  }>;

/** Кладовщик сканом RS кладёт кусок с перепаковки в цех. */
export const acceptRepairPiece = (
  barcode: string,
  actor?: { id?: number | null; name?: string | null },
  retry = false,
) =>
  post({
    action: 'accept',
    barcode,
    userId: actor?.id,
    userName: actor?.name,
    retry,
  }) as Promise<{
    success: boolean;
    alreadyAccepted?: boolean;
    barcode: string;
    material: string | null;
    width: number | null;
    height: number | null;
    reasonLabel: string | null;
  }>;

/**
 * Кладовщик заводит кусок вручную — без стикера RS: ткань, ширина, высота
 * и причина. Сервер выдаёт новый номер RS, кусок сразу лежит в цехе.
 */
export const manualAddRepairPiece = (
  data: {
    material: string;
    width: number;
    height: number;
    reasonCode: string;
    reasonLabel?: string;
  },
  actor?: { id?: number | null; name?: string | null },
) =>
  post({
    action: 'manual_add',
    ...data,
    userId: actor?.id,
    userName: actor?.name,
  }) as Promise<{
    success: boolean;
    pieceId: number;
    barcode: string;
    material: string;
    width: number;
    height: number;
    reasonLabel: string;
  }>;

/**
 * Закройщик закрепляет кусок за заказом.
 *
 * Кусок НЕ списывается — он переходит в reserved: из общего списка пропадает
 * (двое один отрез не возьмут), но остаётся привязанным к заказу и виден в
 * его карточке. Окончательно спишется при раскрое.
 */
export const takeRepairPiece = (
  pieceId: number,
  orderId: number,
  actor?: { id?: number | null; name?: string | null },
): Promise<{ success: true; material: string; width: number; height: number }> =>
  post({
    action: 'use',
    pieceId,
    orderId,
    userId: actor?.id,
    userName: actor?.name,
  }) as Promise<{ success: true; material: string; width: number; height: number }>;

/**
 * Открепить кусок от заказа — он возвращается в перешив к остальным.
 *
 * Доступно, пока ткань не разрезана. После этого в карточке заказа снова
 * появляется выбор рулона, а кусок видят другие закройщицы.
 */
export const releaseRepairPiece = (
  params: { pieceId?: number; orderId?: number },
  actor?: { id?: number | null; name?: string | null },
): Promise<{ success: true }> =>
  post({
    action: 'release',
    pieceId: params.pieceId,
    orderId: params.orderId,
    userId: actor?.id,
    userName: actor?.name,
  }) as Promise<{ success: true }>;

/** Кусок, закреплённый за заказом. null — заказ кроится от рулона. */
export const fetchReservedPiece = (
  orderId: number,
): Promise<{ piece: RepairPiece | null }> =>
  request(`${REPAIR_FABRIC_URL}?action=reserved&orderId=${orderId}`);

/** Администратор списывает кусок (брак, потеря) — след остаётся в истории. */
export const writeOffRepairPiece = (pieceId: number, reason: string) =>
  post({ action: 'write_off', pieceId, reason });

/**
 * Администратор УДАЛЯЕТ строку из таблицы перешива насовсем.
 *
 * В отличие от списания, следа в учёте не остаётся: это для мусора —
 * отправили по ошибке, задублировали, завели неверный размер. Списывать
 * такое нельзя, иначе в отчёте появится брак, которого не было.
 */
export const deleteRepairPiece = (pieceId: number, usedInSewing = false) =>
  post({ action: 'delete', pieceId, usedInSewing });