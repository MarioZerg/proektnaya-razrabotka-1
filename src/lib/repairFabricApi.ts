const REPAIR_FABRIC_URL = 'https://functions.poehali.dev/580fc69a-16df-4299-ae73-af0a840f29d1';

/**
 * ПУТЬ КУСКА: available → reserved → used.
 *
 * available — лежит в цехе, доступен всем закройщицам;
 * reserved  — закреплён за конкретным заказом. Из общего списка исчез, но
 *             ткань ещё цела: кусок можно открепить, и он вернётся в перешив;
 * used      — разрезан при раскрое, вернуть нельзя;
 * written_off — списан администратором (брак, потеря).
 */
export type RepairPieceStatus = 'available' | 'reserved' | 'used' | 'written_off';

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
  /** Насколько кусок больше заказа — только в подборе под заказ. */
  extraWidth?: number;
  extraHeight?: number;
}

export interface RepairPiecesResult {
  pieces: RepairPiece[];
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
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка склада перешива');
  return data;
};

const post = (payload: Record<string, unknown>) =>
  request(REPAIR_FABRIC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

/** Остатки кусков в цехе. status='all' — вся история, включая израсходованные. */
export const fetchRepairPieces = (
  params: { status?: RepairPieceStatus | 'all'; material?: string } = {},
): Promise<RepairPiecesResult> => {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.material) q.set('material', params.material);
  return request(`${REPAIR_FABRIC_URL}?${q.toString()}`);
};

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
): Promise<SendToRepairResult> =>
  post({
    action: 'send',
    goodsWarehouseId,
    reasonCode: reason.code,
    reasonLabel: reason.label,
    userId: actor?.id,
    userName: actor?.name,
  }) as Promise<SendToRepairResult>;

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
export const deleteRepairPiece = (pieceId: number) =>
  post({ action: 'delete', pieceId });