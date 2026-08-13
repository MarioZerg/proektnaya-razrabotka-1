const GOODS_WAREHOUSE_URL = 'https://functions.poehali.dev/370fdff8-7cae-4cc7-a853-b664f3da61cf';

export type GoodsStatus =
  /** Принят, но ещё не разобран и не разложен по полкам. */
  | 'awaiting_shelf'
  /** Возврат с маркетплейса проверяют: годен ли товар к повторной продаже. */
  | 'checking'
  /** Забран с пункта выдачи и лежит у кладовщика: полку ещё не назначили. */
  | 'mp_return'
  /** Передан упаковщицам в цех на осмотр. */
  | 'repacking'
  /** Упаковщица осмотрела и наклеила стикер — вещь ждёт кладовщика. */
  | 'inspected'
  /** Кладовщик забрал из цеха, полку ещё не определил. */
  | 'taken'
  /** Направлен на утилизацию: чистит только администратор. */
  | 'to_dispose'
  | 'in_stock'
  | 'picking'
  /** Сшит в цехе и застикерован ярлыком маркетплейса: лежит в контейнере, ждёт поставки. */
  | 'awaiting_supply'
  | 'reserved'
  | 'shipped'
  | 'lost';

/** Почему товар оказался на складе хранения:
 * cancelled — заказ отменён клиентом (по статусу из API OZON/WB);
 * return — возврат с маркетплейса, принят вручную по номеру заказа;
 * manual — принят вручную (старые записи);
 * admin — администратор добавил вещь на склад вручную по товару из справочника. */
export type ReceiveReason = 'cancelled' | 'return' | 'manual' | 'admin' | 'individual';

export interface GoodsWarehouseItem {
  // Пустые поля сервер в ответ не кладёт — так список склада легче на сотни килобайт.
  // Всё, что бывает пустым, помечено необязательным: отсутствующее поле читается
  // так же, как пустое.
  id: number;
  orderId: number;
  orderNumber?: string | null;
  product?: string | null;
  material?: string | null;
  width?: number | null;
  height?: number | null;
  shelfId?: number | null;
  shelfName?: string | null;
  status: GoodsStatus;
  receivedAt: string;
  shippedAt?: string | null;
  storageBarcode: string;
  lostReason?: string | null;
  lostAt?: string | null;
  receiveReason: ReceiveReason;
  /** Новый заказ маркетплейса, который закрывается этой вещью с полки (автоподбор). */
  reservedOrderId?: number | null;
  reservedOrderNumber?: string | null;
  /** Когда кладовщик наклеил стикер отправления — после этого можно сканировать в поставку. */
  shippingLabeledAt?: string | null;
  /** Площадка, куда вещь поедет: OZON / WB / Yandex. */
  marketplace?: string | null;
  /** Схема поставки: FBS или FBO. */
  orderType?: string | null;
  /** Кластер приёмки — важен для FBO: у каждого кластера своя поставка. */
  cluster?: string | null;
  /** Поставка, в которой вещь уже лежит. Заполнено — значит второй раз её не сканировать. */
  supplyId?: number | null;
  /**
   * Заказ, под который вещь закреплена, уже забрали в цех: его кроят или шьют.
   *
   * Стикер отправления на такую вещь не напечатать — отправление закроет то, что
   * выйдет с конвейера. Для подбора на складе вещь считается недоступной.
   */
  orderInProduction?: boolean;
}

export interface GoodsWarehouseFilters {
  status?: GoodsStatus | 'all';
  material?: string;
  width?: number;
  height?: number;
  shelfId?: number;
}

export const fetchGoodsWarehouse = async (
  filters?: GoodsStatus | GoodsWarehouseFilters
): Promise<GoodsWarehouseItem[]> => {
  const f: GoodsWarehouseFilters = typeof filters === 'string' ? { status: filters } : filters || {};
  const params = new URLSearchParams();
  if (f.status && f.status !== 'all') params.set('status', f.status);
  if (f.material) params.set('material', f.material);
  if (f.width) params.set('width', String(f.width));
  if (f.height) params.set('height', String(f.height));
  if (f.shelfId) params.set('shelf_id', String(f.shelfId));
  const qs = params.toString();
  const res = await fetch(qs ? `${GOODS_WAREHOUSE_URL}?${qs}` : GOODS_WAREHOUSE_URL);
  const data = await res.json();
  return data.items || [];
};

export const fetchGoodsByBarcode = async (barcode: string): Promise<GoodsWarehouseItem> => {
  const res = await fetch(`${GOODS_WAREHOUSE_URL}?barcode=${encodeURIComponent(barcode)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Товар не найден');
  }
  return data.item;
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(GOODS_WAREHOUSE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

// Приём возврата с маркетплейса по номеру заказа (ручной ввод, до появления API-интеграции).
// Полка не выбирается: вещь встаёт в очередь «Ждёт полку» и попадает на полку только
// сканированием стикера хранения — так товар не окажется не на своём месте.
export const receiveReturn = (orderNumber: string) =>
  postAction({ action: 'receive_return', orderNumber });

/** Ручной приём администратором: вещь без заказа с маркетплейса кладётся на склад по товару
 * из справочника. Такие записи помечаются как принятые админом. */
export interface ReceivedGood {
  id: number;
  orderNumber: string;
  product: string;
  storageBarcode: string;
  status: string;
}

/** Ручная приёмка партии: quantity штук одного товара заводятся одним запросом.
 * actorId/actorName — кто принял: в истории вещи должно стоять имя реального человека,
 * а не обезличенное «админ». */
export const adminReceiveGoods = (
  marketplaceItemId: number,
  shelfId?: number,
  quantity = 1,
  actorId?: number,
  actorName?: string,
) =>
  postAction({
    action: 'admin_receive',
    marketplaceItemId,
    shelfId,
    quantity,
    actorId,
    actorName,
  }) as Promise<ReceivedGood & { created: ReceivedGood[]; count: number }>;

/** Кладовщик сканирует стикер хранения вещи, отменённой клиентом, и кладёт её на полку. */
export const placeOnShelf = (barcode: string, shelfId: number) =>
  postAction({ action: 'place_on_shelf', barcode, shelfId });

/** Кладовщик наклеил стикер отправления на вещь с полки, подобранную под новый заказ. */
export const shipLabelGoods = (barcode: string, actorId?: number, actorName?: string) =>
  postAction({ action: 'ship_label', barcode, actorId, actorName }) as Promise<{
    id: number;
    orderId: number;
    orderNumber: string;
    product: string | null;
    shelfName: string | null;
    storageBarcode: string;
    /** Маркетплейс и тип заказа — по ним печатается нужный стикер. */
    marketplace: string | null;
    orderType: string | null;
  }>;

/** Перенести пачку отсканированных вещей на выбранную полку одним действием. */
export const moveGoodsShelfBatch = (
  barcodes: string[],
  shelfId: number,
  actorId?: number,
  actorName?: string,
) =>
  postAction({ action: 'move_shelf_batch', barcodes, shelfId, actorId, actorName }) as Promise<{
    success: true;
    moved: number;
    skipped: number;
    shelfName: string | null;
  }>;

export const moveGoodsShelfByBarcode = (
  barcode: string,
  shelfId: number | null,
  actorId?: number,
  actorName?: string,
) =>
  postAction({ action: 'move_shelf_by_barcode', barcode, shelfId, actorId, actorName }) as Promise<{
    success: true;
    id: number;
    product: string | null;
    fromShelf: string | null;
    toShelf: string | null;
    storageBarcode: string;
  }>;

export const returnGoodsToWorkshop = (id: number) => postAction({ action: 'return_to_workshop', id });

// Сканер подбора: отмечает товар (по штрихкоду хранения) как нужный для будущей поставки FBS.
/** Сколько вещей уже подобрано под заказы и ждёт стикера отправления у кладовщика. */
export interface PickingPending {
  pendingLabel: number;
  awaitingShelf: number;
}

export const fetchPickingPending = async (): Promise<PickingPending> => {
  const res = await fetch(`${GOODS_WAREHOUSE_URL}?pending_count=1`);
  const data = await res.json();
  return { pendingLabel: data.pendingLabel || 0, awaitingShelf: data.awaitingShelf || 0 };
};

/** Проверка подбора: нужны ли ещё вещи, подобранные под заказы.
 *
 * Заказ мог уехать к покупателю или отмениться — ярлык для него маркетплейс уже не
 * отдаёт. Такие вещи возвращаются на полку, чтобы не висеть в подборе мёртвым грузом.
 * @param gwId проверить одну вещь; без него проверяется весь подбор. */
export const verifyPicking = (gwId?: number, actorId?: number, actorName?: string) =>
  postAction({ action: 'verify_picking', gwId, actorId, actorName }) as Promise<{
    total: number;
    released: {
      id: number;
      storageBarcode: string;
      orderNumber: string | null;
      reason: string;
    }[];
  }>;

/** Ручной пересчёт подбора по всему складу — страховка, если что-то не подхватилось. */
export const rematchStock = () =>
  postAction({ action: 'rematch_stock' }) as Promise<{ matched: number }>;

export const startPicking = (barcode: string) => postAction({ action: 'start_picking', barcode });

export const cancelPicking = (id: number) => postAction({ action: 'cancel_picking', id });

export const markGoodsLost = (id: number, reason: string) =>
  postAction({ action: 'mark_lost', id, reason });

/** Заказ, пришедший на подбор: под него ищут готовую вещь на складе. */
export interface PickingOrder {
  id: number;
  orderNumber: string | null;
  product: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  /** Когда система подобрала вещь под этот заказ. */
  createdAt: string | null;
  marketplace: string | null;
  /** Стикер хранения на вещи и полка, где она лежит. */
  storageBarcode?: string | null;
  shelfName?: string | null;
  /** Схема поставки: FBS — вещь едет своим пакетом с ярлыком маркетплейса,
   * FBO — коробкой на склад площадки. Работа кладовщика в этих случаях разная. */
  orderType?: string | null;
  /** Кластер приёмки — важен для FBO. */
  cluster?: string | null;
}

/** Заказы, ожидающие подбора со склада: ещё не шьются и вещь под них не найдена. */
export const fetchPickingOrders = async (): Promise<PickingOrder[]> => {
  const res = await fetch(`${GOODS_WAREHOUSE_URL}?picking_orders=1`);
  if (!res.ok) throw new Error('Не удалось загрузить заказы к подбору');
  return res.json();
};

/** Уведомление на панели администратора. */
export interface AdminNotification {
  id: number;
  kind: string;
  title: string;
  message: string | null;
  actorName: string | null;
  link: string | null;
  createdAt: string | null;
  isRead: boolean;
}

/** Уведомления для панели администратора. */
export const fetchAdminNotifications = async (): Promise<{
  items: AdminNotification[];
  unread: number;
}> => {
  const res = await fetch(`${GOODS_WAREHOUSE_URL}?notifications=1`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить уведомления');
  return data;
};

/** Убрать уведомления с панели. Без списка id очищает все. */
export const dismissNotifications = (
  ids: number[],
  actorId?: number,
  actorName?: string,
) => postAction({ action: 'dismiss_notification', ids, actorId, actorName }) as Promise<{
  success: true;
  removed: number;
}>;

/** Этапы движения возврата: от приёмки до полки. */
export type InspectionStage =
  | 'fromMarketplace'
  | 'fromReturn'
  | 'atPackers'
  | 'inspected'
  | 'taken'
  | 'toDispose'
  | 'disposed'
  /** Служебный запрос: всё, что кладовщик может прямо сейчас положить на полку
   * (осмотрено + забрано с производства). Виджетом не показывается. */
  | 'readyShelf';

/** Счётчики по всем шести этапам осмотра возвратов. */
export type InspectionCounts = Record<Exclude<InspectionStage, 'readyShelf'>, number>;

/** Вещь на одном из этапов осмотра. */
export interface InspectionItem {
  id: number;
  storageBarcode: string;
  status: string;
  receivedAt: string | null;
  inspectedAt: string | null;
  takenAt: string | null;
  disposeReason: string | null;
  lostReason: string | null;
  orderNumber: string | null;
  product: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  marketplace: string | null;
  inspectedByName: string | null;
  takenByName: string | null;
}

/** Счётчики виджетов и список выбранного этапа осмотра. */
export const fetchInspection = async (
  stage?: InspectionStage,
): Promise<{ counts: InspectionCounts; items: InspectionItem[] }> => {
  const res = await fetch(
    `${GOODS_WAREHOUSE_URL}?inspection=1${stage ? `&stage=${stage}` : ''}`,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить осмотр');
  return data;
};

/** Передать принятые возвраты упаковщицам на осмотр. */
export const moveToWorkshop = (ids: number[], actorId?: number, actorName?: string) =>
  postAction({ action: 'move_to_workshop', ids, actorId, actorName }) as Promise<{
    success: true;
    moved: number;
  }>;

/**
 * Отправить возвраты сразу на полку, минуя осмотр в цехе.
 *
 * Вещь приехала в порядке — гонять её к упаковщицам незачем. Вещи встают в очередь
 * на укладку, полку кладовщик назначит сканированием в окне «Разложить по полкам».
 */
/** Вещь, уложенная на полку: по ней сразу печатается стикер хранения. */
export interface PlacedFromInspection {
  id: number;
  storageBarcode: string;
  orderNumber: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  product: string | null;
}

export const toShelfFromInspection = (
  ids: number[],
  shelfId: number,
  actorId?: number,
  actorName?: string
): Promise<{
  success: true;
  moved: number;
  shelfName: string;
  items: PlacedFromInspection[];
}> =>
  postAction({ action: 'to_shelf_from_inspection', ids, shelfId, actorId, actorName }) as Promise<{
    success: true;
    moved: number;
    shelfName: string;
    items: PlacedFromInspection[];
  }>;

/** Одна пачка раскладки: полка и стикеры вещей, которые кладут именно на неё. */
export interface ShelfBatch {
  shelfId: number;
  barcodes: string[];
}

/** Приём осмотренных возвратов с производства сразу на полки хранения.
 * Кладовщик может чередовать полки в одном окне — отправляем всё одним запросом. */
export const placeInspectedBatch = (
  groups: ShelfBatch[],
  actorId?: number,
  actorName?: string,
) => postAction({ action: 'place_inspected_batch', groups, actorId, actorName }) as Promise<{
  total: number;
  placed: {
    barcode: string;
    orderNumber: string | null;
    product: string | null;
    shelfName: string;
    autoMatched: number;
  }[];
  errors: { barcode: string; error: string }[];
}>;

/**
 * Кладовщик забирает осмотренную вещь из цеха по стикеру хранения.
 *
 * С экрана убрано: отдельная кнопка «Забрать из цеха» дублировала приёмку осмотренных
 * возвратов, где тот же стикер сканируется, но вещь сразу попадает на полку. Оставлено
 * на случай, если понадобится вернуть промежуточный шаг «забрал, полку назначу позже» —
 * серверное действие и статус «Забрано с производства» продолжают работать.
 */
export const takeFromWorkshop = (barcode: string, actorId?: number, actorName?: string) =>
  postAction({ action: 'take_from_workshop', barcode, actorId, actorName }) as Promise<{
    id: number;
    product: string | null;
    orderNumber: string | null;
    storageBarcode: string;
    toDispose: boolean;
  }>;

/** Отправить вещи на утилизацию (брак, плохое качество). */
export const sendToDispose = (
  ids: number[],
  reason: string,
  actorId?: number,
  actorName?: string,
) => postAction({ action: 'send_to_dispose', ids, reason, actorId, actorName }) as Promise<{
  success: true;
  moved: number;
}>;

/** Списать утилизированные вещи — доступно только администратору. */
export const clearDisposed = (ids: number[], actorId?: number, actorName?: string) =>
  postAction({ action: 'clear_disposed', ids, actorId, actorName }) as Promise<{
    success: true;
    cleared: number;
  }>;

/** Карточка возврата: что за вещь, кто её делал и почему её вернули. */
export interface ScannedReturn {
  orderId: number;
  orderNumber: string;
  product: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  marketplace: string | null;
  ozonStatus: string | null;
  orderStatus: string | null;
  createdAt: string | null;
  cancelledAt: string | null;
  cutterName: string | null;
  sewerName: string | null;
  packerName: string | null;
  returnReason: string | null;
  mpStatus: string | null;
}

/** Сканирование ярлыка FBS на приехавшей вещи: проверяем, можно ли принять возврат. */
export const scanReturn = (barcode: string) =>
  postAction({ action: 'scan_return', barcode }) as Promise<ScannedReturn>;

/** Возврат уходит на осмотр в цех: вещь получает статус «На проверке». */
/** @param toPacker true — вещь сразу уходит упаковщице в цех («На проверке»),
 * false — кладовщик берёт её на разбор и решит позже. */
export const sendReturnToCheck = (
  orderId: number,
  actorId?: number,
  actorName?: string,
  toPacker?: boolean,
) =>
  postAction({ action: 'send_to_check', orderId, actorId, actorName, toPacker }) as Promise<{
    success: true;
    id: number;
    storageBarcode: string;
  }>;

/** Одно событие в истории вещи: кто и что с ней сделал. */
export interface GoodsHistoryEntry {
  userName: string | null;
  action: string;
  description: string | null;
  createdAt: string | null;
}

/** Карточка вещи со склада: что это, где лежит и вся история движения. */
export interface GoodsCard {
  id: number;
  status: GoodsStatus;
  storageBarcode: string;
  receiveReason: string;
  receivedAt: string | null;
  shippedAt: string | null;
  shippingLabeledAt: string | null;
  matchedAt: string | null;
  shelfName: string | null;
  sourceOrderNumber: string | null;
  product: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  sourceMarketplace: string | null;
  reservedOrderId: number | null;
  reservedOrderNumber: string | null;
  reservedMarketplace: string | null;
  reservedOrderType: string | null;
  lostReason: string | null;
  supplyId: number | null;
  supplyStatus: string | null;
  history: GoodsHistoryEntry[];
}

/** Карточка вещи со всей историей её движения по складу. */
export const fetchGoodsCard = async (id: number): Promise<GoodsCard> => {
  const res = await fetch(`${GOODS_WAREHOUSE_URL}?card_id=${id}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить карточку');
  return data;
};

/** Вещь отстикерована и едет в поставку: попадёт в счётчик FBS OZON. */
export const sendGoodsToSupply = (id: number, actorId?: number, actorName?: string) =>
  postAction({ action: 'send_to_supply', id, actorId, actorName });

/** Удалить запись со склада. Только администратор и только для вещей на хранении. */
export const deleteGoods = (id: number, actorId?: number, actorName?: string) =>
  postAction({ action: 'delete_goods', id, actorId, actorName });

/** Вещь испорчена: списываем её со склада, а заказ возвращаем в производство — сошьют заново. */
export const sendGoodsToSewing = (
  id: number,
  reason: string,
  actorId?: number,
  actorName?: string,
) =>
  postAction({ action: 'send_to_sewing', id, reason, actorId, actorName }) as Promise<{
    success: true;
    returnedOrder: string | null;
  }>;