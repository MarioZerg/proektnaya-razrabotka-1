const OZON_FBO_URL = 'https://functions.poehali.dev/697620a6-2bfe-40f7-af06-0de882dd0391';

export interface OzonFboApplication {
  orderId: number;
  orderNumber: string | null;
  state: string | null;
  createdDate: string | null;
  deadline: string | null;
  warehouse: string | null;
  timeslotFrom: string | null;
  timeslotTo: string | null;
  /** id нашей поставки, если заявка уже импортирована. */
  supplyId: number | null;
}

export interface OzonFboImportResult {
  supplyId: number;
  created: number;
  skippedNoItem: number;
  totalItems: number;
  unmatched: Array<{ ozonSku: number | null; offerId: string | null; name: string | null }>;
  orderNumber: string | null;
}

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(OZON_FBO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка OZON FBO');
  }
  return data;
};

export const fetchOzonFboApplications = async (): Promise<OzonFboApplication[]> => {
  const data = await post({ action: 'list_applications' });
  return (data.applications || []) as OzonFboApplication[];
};

/** Сколько ткани съест заявка и сколько её сейчас на складе — по каждому материалу. */
export interface FboMaterialNeed {
  material: string;
  /** Погонные метры на всю заявку (норма из состава товара × количество). */
  meters: number;
  /** Штук изделий из этой ткани. */
  items: number;
  /** Остаток на складе; null — ткани нет в справочнике материалов. */
  inStock: number | null;
  unit: string | null;
}

export interface OzonFboCompositionCheck {
  totalItems: number;
  totalQty: number;
  matchedItems: number;
  matchedQty: number;
  unmatchedItems: number;
  unmatched: Array<{ ozonSku: number | null; offerId: string | null; name: string | null; quantity: number }>;
  /** Расход ткани по материалам. Пусто у старых ответов сервера. */
  materials?: FboMaterialNeed[];
  totalMeters?: number;
}

export const checkOzonFboComposition = (orderId: number): Promise<OzonFboCompositionCheck> =>
  post({ action: 'check_composition', orderId }) as Promise<OzonFboCompositionCheck>;

export const importOzonFboComposition = (
  orderId: number,
  actor?: { id?: number | null; name?: string | null }
): Promise<OzonFboImportResult> =>
  post({
    action: 'import_composition',
    orderId,
    createdBy: actor?.id,
    actorId: actor?.id,
    actorName: actor?.name,
  }) as Promise<OzonFboImportResult>;

export interface OzonCloseBoxesResult {
  closedBoxes: number;
  stickersSaved: number;
  note: string | null;
}

/**
 * Закрыть короба поставки OZON FBO: создаёт грузоместа на OZON и тянет этикетки.
 *
 * boxId — закрыть ОДИН короб. Кладовщик работает коробами: набил, заклеил,
 * наклеил этикетку, взял следующий. Закрывать всё скопом в конце неудобно —
 * к тому моменту короба уже заклеены, и разложить по ним этикетки нечем.
 */
export const closeOzonBoxes = (
  supplyId: number,
  boxId?: number,
): Promise<OzonCloseBoxesResult> =>
  post({ action: 'close_boxes', supplyId, boxId }) as Promise<OzonCloseBoxesResult>;
export interface OzonAllBoxLabelsResult {
  /** Ссылка на собранный PDF со стикерами всех коробов. */
  url: string;
  /** Сколько наклеек попало в файл. */
  boxes: number;
  /** Номера коробов, у которых стикера нет (в файл не вошли). */
  missingBoxes: string[];
}

/**
 * Собрать ОДИН PDF со стикерами всех коробов поставки — печать пачкой.
 *
 * Короба закрывают по одному и печатают стикер сразу, но когда поставка
 * собрана целиком, удобнее отправить на принтер весь комплект разом.
 * Страницы идут по номерам коробов: лист №1 — короб №1.
 */
export const fetchOzonAllBoxLabels = (
  supplyId: number,
  actor?: { id?: number | null; name?: string | null },
): Promise<OzonAllBoxLabelsResult> =>
  post({
    action: 'all_box_labels',
    supplyId,
    actorId: actor?.id,
    actorName: actor?.name,
  }) as Promise<OzonAllBoxLabelsResult>;

/**
 * Переоткрыть закрытый короб, чтобы поправить его состав.
 *
 * Закрытие короба необратимо: создаётся грузоместо на OZON, приходит этикетка,
 * состав замораживается. Кладовщик же нередко видит ошибку сразу после
 * закрытия — здесь он может вернуть короб в работу.
 *
 * Грузоместо на OZON удаляется, старый стикер стирается: печатать его после
 * правки нельзя. Закроет короб заново — придёт свежая этикетка.
 */
export const reopenOzonBox = (
  boxId: number,
  actor?: { id?: number | null; name?: string | null },
): Promise<{ success: true; boxNumber: number; note: string | null }> =>
  post({
    action: 'reopen_box',
    boxId,
    actorId: actor?.id,
    actorName: actor?.name,
  }) as Promise<{ success: true; boxNumber: number; note: string | null }>;

export interface OzonBoxLabelResult {
  /** Готова ли этикетка. false — OZON ещё генерирует файл, нужно повторить. */
  ready: boolean;
  url?: string;
  boxNumber?: number;
  note?: string;
}

/**
 * Догрузить этикетку уже закрытого короба.
 *
 * Закрытие короба и получение этикетки разделены: обе операции в один вызов
 * не укладываются в отведённое функции время, и раньше закрытие обрывалось
 * на полпути. Теперь короб закрывается сразу, а наклейка забирается этим
 * запросом — столько раз, сколько потребуется.
 */
export const fetchOzonBoxLabel = async (boxId: number): Promise<OzonBoxLabelResult> => {
  const res = await fetch(OZON_FBO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'fetch_box_label', boxId }),
  });
  const data = await res.json();

  // «Ещё не готово» (202) и «слишком часто» (429) — НЕ ошибки, а нормальный
  // ход дела: файл готовится асинхронно. Общий обработчик превратил бы их в
  // исключение и оборвал ожидание на первом же заходе.
  if (res.status === 202 || res.status === 429) {
    return { ready: false, note: data.note };
  }
  if (!res.ok) throw new Error(data.error || 'Ошибка OZON FBO');
  return data as OzonBoxLabelResult;
};