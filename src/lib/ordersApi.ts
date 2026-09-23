const ORDERS_URL = 'https://functions.poehali.dev/1d8ed922-bded-4f5a-a367-a0742711203a';

/** 'Отгружен' — заказ уехал на маркетплейс в составе закрытой поставки. */
export type OrderStatus = 'Новый' | 'В работе' | 'Выполнен' | 'Отгружен' | 'Отменён';
export type OrderType = 'FBO' | 'FBS' | 'Индивидуальный';
export type Marketplace = 'OZON' | 'WB' | 'Yandex';
/** 'Со склада' — заказ закрывается вещью, которая уже лежит на полке склада (осталась от
 * отменённого заказа): шить заново не нужно, кладовщик клеит стикер отправления и сдаёт
 * вещь в поставку. Такие заказы на конвейер производства не попадают. */
export type SewingStatus =
  | 'Новый'
  | 'На раскрое'
  | 'Раскроено'
  | 'В работе'
  | 'Стикеровка'
  | 'Готовые'
  | 'Со склада';

export interface Order {
  id: number;
  orderNumber: string;
  marketplace: Marketplace;
  orderType: OrderType;
  status: OrderStatus;
  // Пустые поля сервер в ответ не кладёт — так список заказов легче на сотни
  // килобайт. Поэтому всё, что бывает пустым, помечено как необязательное:
  // отсутствующее поле читается так же, как пустое.
  cluster?: string | null;
  product?: string;
  quantity: number;
  source?: 'manual' | 'api';
  createdAt: string;
  completedAt?: string | null;
  material?: string | null;
  width?: number | null;
  height?: number | null;
  sewingStatus: string;
  assignedUserId: number | null;
  assignedUserName: string | null;
  workshopId: number | null;
  workshopName: string | null;
  /** Кто раскроил заказ — отдельно от assignedUserId, который перезаписывается на швею
   * при take_order. Заполняется в момент раскроя (action 'cut') и дальше не меняется. */
  cutterUserId: number | null;
  cutterUserName: string | null;
  /** Кто отшил заказ — заполняется при отправке на стикеровку (action 'send_to_stickering')
   * и дальше не меняется, аналогично cutterUserId. */
  sewerUserId: number | null;
  sewerUserName: string | null;
  /** Кто упаковал (закрыл) заказ на терминале стикеровки — заполняется при закрытии
   * заказа (backend/kiosk, action 'close_order') и дальше не меняется. */
  packerUserId: number | null;
  packerUserName: string | null;
  /** Когда вещь раскроили и отшили — по этим датам цех сверяет свою выработку.
   * Дата заказа покупателя для этого не годится: заказ мог пролежать в очереди. */
  cutAt?: string | null;
  sewnAt?: string | null;
  /** Номер вешалки, на которую подвешен раскроенный товар. 0 = не назначена (заполняется
   * через отдельную вкладку "Вешалки", ещё не реализована). */
  hangerNumber: number;
  /** Название вешалки, если задано. Пусто — показываем номер. */
  hangerName?: string | null;
  /** Магазин заказа: МЕГАТЮЛЬ или ДЮНА. Цех общий, но вещи разные. */
  shopName?: string | null;
  shopColor?: string | null;
  /**
   * ЭТАП ОВЕРЛОКА.
   *
   * requiresOverlock — у ткани осыпается край: вещь сначала обмётывают на
   *   оверлоке и только потом отдают швее на прямострочку. Проставляется на
   *   раскрое по признаку ткани и дальше у заказа не меняется.
   * overlockedAt — край обметали. Пока пусто, вещь ждёт в очереди «Оверлок»;
   *   после заполнения она возвращается в «Раскроено» с пометкой «Обработан».
   */
  requiresOverlock?: boolean;
  overlockedAt?: string | null;
  overlockUserId?: number | null;
  overlockUserName?: string | null;
  /** Статус отправления на стороне OZON (только чтение, для FBS-заказов OZON). */
  ozonStatus?: string | null;
  /**
   * Заказ отменён покупателем — признак считает сервер.
   *
   * Отмену видит МАРКЕТПЛЕЙС: у каждой площадки своё слово для неё
   * (ozon_status='cancelled', ym_status='...CANCELLED'), а наш собственный
   * status при этом остаётся прежним. Разбирать статусы площадок на экране
   * значит однажды забыть очередной, поэтому считаем один раз на сервере.
   */
  isCancelled?: boolean | null;
  ozonPostingNumber?: string | null;
  /** Штрихкод товара маркетплейса (из справочника, фиксируется при импорте OZON FBO) —
   * печатается на стикере FBO сшитого товара. */
  productBarcode?: string | null;
  /** OZON SKU товара (из справочника) — именно по нему товар добавляется в поставку FBO OZON,
   * поэтому на стикере OZON печатается он (OZN + ozonSku), а не штрихкод. */
  productOzonSku?: string | null;
  /** Дата и время оформления заказа покупателем на маркетплейсе (WB, OZON). По ней считаем,
   * сколько заказ реально ждёт отгрузки — а не с момента загрузки в нашу систему. */
  marketplaceCreatedAt?: string | null;
  /** Заказ покупателя из нескольких вещей (Яндекс Маркет). На все вещи такого заказа
   * маркетплейс выдаёт ОДИН ярлык, поэтому они связаны общим ключом и идут по цеху вместе:
   * их берёт один закройщик и шьёт одна швея. В интерфейсе показываем «1 из 3». */
  groupKey?: string | null;
  groupSize?: number | null;
  groupPosition?: number | null;
  /** Заказ юридического лица (B2B с OZON). Шьётся как обычный, но помечается в цехе. */
  isLegalEntity?: boolean;
  /** Название компании-покупателя и её ИНН — приходят от OZON вместе с заказом. */
  legalCompanyName?: string | null;
  legalInn?: string | null;
  /** Сколько ткани реально уйдёт со склада на одно изделие (пог.м., с запасом на
   * подгибку) — из карточки товара. null, если карточка такого размера не заведена. */
  fabricPerItem?: number | null;
  /**
   * НОМЕР НА БИРКЕ ПЕРЕДАННОГО КРОЯ.
   *
   * Покупатель отменил заказ уже после раскроя, а следом пришёл новый заказ
   * того же размера — крой отдали ему, шить с нуля не пришлось. Но бирка на
   * вешалке осталась от ОТМЕНЁННОГО заказа: перепечатать её некому, заказы
   * приходят и ночью.
   *
   * Поэтому швее показываем этот номер: искать вещь в цехе она будет по нему,
   * а не по номеру своего заказа.
   */
  cutFromOrderNumber?: string | null;
  /**
   * Крой этого (отменённого) заказа уже отдан живому заказу.
   *
   * Доделывать по нему нечего: вещь сошьют под новым номером и отправят
   * покупателю, а не на склад. Из вкладки «Отменённые с кроем» такой заказ
   * уходит — иначе швея пошла бы искать вешалку, которую забрала другая работа.
   */
  cutGivenToOrderId?: number | null;
}

export interface OrderMaterialUsage {
  id: number;
  materialId: number;
  materialName: string | null;
  unit: string | null;
  rollId: number | null;
  rollBarcode: string | null;
  quantity: number;
  createdAt: string;
}

/**
 * Кусок с перешива, из которого скроена вещь.
 *
 * Остаётся в карточке НАВСЕГДА. Когда заказ закрыт куском, рулона в расходе
 * нет вовсе: ткань стоит без рулона, и без этой справки след обрывался бы —
 * вещь выглядела бы сшитой из воздуха, а разобрать жалобу или повторный брак
 * было бы нечем.
 */
export interface OrderRepairPiece {
  id: number;
  /** Номер со стикера, который упаковщица наклеила на вещь: RS-000042. */
  barcode: string | null;
  material: string;
  width: number;
  height: number;
  status: string;
  /** За что вещь ушла в перешив. */
  reasonLabel: string | null;
  /** Кто отправил кусок в перешив. */
  createdByName: string | null;
  /** Кто из закройщиков взял его под этот заказ. */
  usedByName: string | null;
  usedAt: string | null;
}

export interface OrderDetail extends Order {
  materialUsage: OrderMaterialUsage[];
  /** Кусок с перешива, из которого сделана вещь. null — кроили от рулона. */
  repairPiece?: OrderRepairPiece | null;
  requiredFabricMaterialId: number | null;
  requiredFabricMaterialName: string | null;
  requiredTrimMaterialId: number | null;
  requiredTrimMaterialName: string | null;
  /** Товар справочника, к которому привязан заказ — определяет штрихкод для стикера FBO. */
  marketplaceItemId: number | null;
  /** Последняя вешалка, выбранная закройщиком заказа — подставляется по умолчанию при раскрое. */
  lastHangerNumber: number | null;
}

/** Что лежит следующим в очереди раскроя для цеха: связка Яндекса или обычный стек.
 * Только для показа закройщику — очередь не занимает и ничего не меняет. */
export interface StackPreview {
  kind: 'group' | 'stack' | 'none';
  count: number;
  /** Сколько заказов закройщик может держать на руках — настройка цеха. */
  cutterLimit: number;
}

export const fetchStackPreview = async (workshopId: number): Promise<StackPreview> => {
  const res = await fetch(`${ORDERS_URL}?stackPreview=1&workshopId=${workshopId}`);
  if (!res.ok) return { kind: 'none', count: 0, cutterLimit: 20 };
  const data = await res.json();
  return {
    kind: data.kind ?? 'none',
    count: data.count ?? 0,
    cutterLimit: data.cutterLimit ?? 20,
  };
};

/**
 * Список заказов цеха.
 *
 * historyFor / historyRole — чью историю подмешивать к активным заказам.
 * Архив закрытых заказов ограничен по объёму и раньше делился между всеми
 * сотрудниками сразу: место в нём занимали чужие заказы, а швея на вкладке
 * «Готовые» видела только свои — и её выработка обрывалась на нескольких днях.
 * Передав исполнителя, забираем историю именно по нему: весь запас достаётся
 * одному человеку, и он видит свою работу за куда больший срок.
 */
export const fetchOrders = async (
  historyFor?: number,
  historyRole?: string,
): Promise<Order[]> => {
  const params = new URLSearchParams();
  if (historyFor && (historyRole === 'sewer' || historyRole === 'cutter')) {
    params.set('historyFor', String(historyFor));
    params.set('historyRole', historyRole);
  }
  const qs = params.toString();
  const res = await fetch(qs ? `${ORDERS_URL}?${qs}` : ORDERS_URL);
  const data = await res.json();
  return data.orders || [];
};

/**
 * ПОИСК ЗАКАЗА ПО НОМЕРУ — МИМО ЛИМИТОВ СПИСКА.
 *
 * Обычный список отдаёт только свежую часть истории: примерно месяц закрытых
 * заказов и три недели отмен, дальше ответ не помещается в потолок платформы.
 * Поэтому фильтровать список на экране бесполезно — заказа прошлого квартала
 * в нём просто НЕТ, и на вопрос «где мой заказ» ответить было нечем.
 *
 * Здесь спрашиваем сервер: он ищет прямо в базе и находит заказ любой давности.
 * Ищет сразу по нашему номеру, отправлению OZON, номерам WB и Яндекса — человек
 * не обязан знать, чей номер ему назвали.
 */
export const searchOrders = async (query: string): Promise<Order[]> => {
  const q = query.trim();
  // Одна буква даёт половину базы: ответ тяжёлый, а толку никакого.
  if (q.length < 2) return [];
  const res = await fetch(`${ORDERS_URL}?search=${encodeURIComponent(q)}`);
  const data = await res.json();
  return data.orders || [];
};

export const fetchOrderDetail = async (id: number): Promise<OrderDetail> => {
  const res = await fetch(`${ORDERS_URL}?id=${id}`);
  const data = await res.json();
  return data.order;
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(ORDERS_URL, {
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

/**
 * Создать заказы вручную. quantity — сколько одинаковых изделий нужно отшить:
 * сервер заведёт столько отдельных заявок с автоматическими номерами.
 */
export const createManualOrder = (order: {
  marketplace?: Marketplace | string;
  orderType: OrderType;
  cluster?: string;
  marketplaceItemId: number;
  quantity?: number;
}) => postAction({ action: 'create_manual', ...order });

export const updateOrder = (
  id: number,
  fields: Partial<{
    orderNumber: string;
    marketplace: Marketplace;
    orderType: OrderType;
    status: OrderStatus;
    product: string;
    sewingStatus: SewingStatus;
    assignedUserId: number | null;
    workshopId: number | null;
    marketplaceItemId: number | null;
    actorId: number;
  }>
) => postAction({ action: 'update_order', id, ...fields });

// actorId обязателен: по нему сервер проверяет, что раскраивает именно закройщик.
export const cutOrder = (id: number, rollId?: number, hangerNumber?: number, actorId?: number) =>
  postAction({ action: 'cut', id, rollId, hangerNumber, actorId });

/** Раскроить и отправить в цех ВСЮ связку Яндекса разом — заказ покупателя из десятков вещей
 * закройщик не должен раскраивать по одной кнопке на каждую вещь. */
export const cutOrderGroup = async (
  id: number,
  rollId?: number,
  hangerNumber?: number,
  actorId?: number
): Promise<{ cutCount: number }> => {
  // Большая связка раскраивается порциями: за один вызов сервер обрабатывает несколько вещей,
  // иначе упирается в лимит времени. Повторяем, пока в связке остаются нераскроенные вещи —
  // для закройщика это по-прежнему одно нажатие кнопки.
  let total = 0;
  for (let pass = 0; pass < 30; pass += 1) {
    const res = (await postAction({ action: 'cut_group', id, rollId, hangerNumber, actorId })) as {
      cutCount: number;
      groupRemaining?: number;
    };
    total += res.cutCount || 0;
    if (!res.groupRemaining) break;
  }
  return { cutCount: total };
};

/**
 * СНЯТЬ ЗАКАЗ С КОНВЕЙЕРА — И ОТМЕНИТЬ ЕГО НА МАРКЕТПЛЕЙСЕ.
 *
 * Снимается только нетронутый заказ: этап «Новый», никем не взят, не раскроен.
 * Сервер сперва отменяет его по API площадки и лишь после подтверждения помечает
 * отменённым у нас — иначе маркетплейс продолжал бы ждать отгрузку заказа,
 * которого в цехе уже нет, и начислял просрочку.
 *
 * Связка Яндекса снимается целиком: cancelledIds — все вещи, которые ушли.
 */
export const deleteOrder = (id: number) =>
  postAction({ action: 'delete_order', id }) as Promise<{
    success: boolean;
    cancelledIds: number[];
    /** Пояснение, если на площадке отменять было нечего (индивидуальный заказ и т.п.). */
    note?: string | null;
  }>;

/**
 * ВЕРНУТЬ ОШИБОЧНО СНЯТЫЙ ЗАКАЗ НА КОНВЕЙЕР.
 *
 * Кнопка снятия стоит рядом с «Изменить», и промахнуться легко. Раньше это был
 * тупик: заказ навсегда оставался отменённым, и его заводили заново руками,
 * теряя номер и привязку к товару.
 *
 * Вернуть можно ТОЛЬКО свою отмену. Если заказ отменил маркетплейс, сервер
 * откажет: отправления на площадке больше нет, отгружать вещь некуда.
 */
export const restoreOrder = (id: number) =>
  postAction({ action: 'restore_order', id }) as Promise<{
    success: boolean;
    /** Все вернувшиеся вещи — связка Яндекса возвращается целиком. */
    restoredIds: number[];
  }>;

/** Заказ отменён — снят с конвейера нами или отменён покупателем на площадке. */
export const isOrderCancelled = (o: Order): boolean =>
  !!o.isCancelled || o.status === 'Отменён' || o.sewingStatus === 'Отменён';

/**
 * Заказ можно вернуть в работу: отменяли его МЫ, а не маркетплейс.
 *
 * Отмену площадки видно по её статусу (ozonStatus). Такую не возвращаем: заказа
 * на той стороне уже нет, вещь будет некуда отгрузить — сервер это тоже
 * проверяет, а здесь мы просто не показываем заведомо бесполезную кнопку.
 */
export const canRestoreOrder = (o: Order): boolean => {
  if (!isOrderCancelled(o)) return false;
  const ozonCancelled = (o.ozonStatus || '').toLowerCase().startsWith('cancel');
  return !ozonCancelled;
};

/** Заказ ещё не тронут в цехе — только такой можно снять с конвейера.
 *
 * Правило одно на весь фронт, чтобы кнопка «Снять с конвейера» и в таблице заказов,
 * и в карточке вещи появлялась по одному и тому же условию — а сервер проверял то же
 * самое ещё раз, уже по токену сессии. */
export const canPullFromConveyor = (o: Order): boolean => {
  const cancelled = !!o.isCancelled || o.status === 'Отменён' || o.sewingStatus === 'Отменён';
  if (cancelled) return false;
  return (
    (o.sewingStatus || 'Новый') === 'Новый' &&
    !o.assignedUserId &&
    !o.cutAt
  );
};

/**
 * МАССОВОЕ СНЯТИЕ ЗАКАЗОВ С КОНВЕЙЕРА, КОГДА ЗАКОНЧИЛСЯ МАТЕРИАЛ.
 *
 * Шить нечем, а в очереди стоят десятки заказов из этой ткани. Их нужно убрать
 * и у себя, и на маркетплейсе — иначе площадка ждёт отгрузку и начисляет просрочку.
 */
export interface BulkCancelPreview {
  material: string;
  /** Что именно снимется — этот список фронт отдаёт обратно при подтверждении. */
  orderIds: number[];
  /** Первые полсотни номеров — показать админу, что за заказы уйдут. */
  orderNumbers: string[];
  total: number;
  /** Сколько среди них связок Яндекса (снимаются целиком). */
  groups: number;
  byMarketplace: Record<string, number>;
  /** Заказы этого материала, которые останутся: они уже в раскрое или в пошиве. */
  keptInWork: number;
  /** Связки, которые не тронули: часть их вещей уже в работе. */
  blockedGroups: number;
}

export const previewBulkCancel = (
  material: string,
  marketplace?: string
): Promise<BulkCancelPreview> =>
  postAction({ action: 'bulk_cancel_preview', material, marketplace }) as Promise<BulkCancelPreview>;

export interface BulkCancelResult {
  done: { id: number; orderNumber: string; note?: string | null }[];
  failed: { id: number; orderNumber: string; error: string }[];
  /** Заказы, которые успели взять в работу между подтверждением и отменой. */
  skipped: { id: number; orderNumber: string }[];
}

/**
 * Снимает заказы порциями, пока список не кончится.
 *
 * Каждый заказ нужно отменить на стороне маркетплейса, а это сетевой запрос —
 * сотню таких в один вызов функции не уложить, она оборвётся по таймауту на
 * середине. Поэтому сервер за раз берёт небольшую порцию и возвращает остаток,
 * а мы спокойно ходим за ним снова. onProgress двигает полоску на экране, чтобы
 * админ видел: процесс идёт, а не завис.
 */
export const bulkCancelOrders = async (
  material: string,
  orderIds: number[],
  onProgress?: (processed: number, total: number) => void
): Promise<BulkCancelResult> => {
  const result: BulkCancelResult = { done: [], failed: [], skipped: [] };
  let remaining = [...orderIds];
  const total = orderIds.length;

  // Потолок на число заходов: если сервер вдруг перестанет разбирать очередь,
  // страница не должна крутиться вечно.
  for (let pass = 0; pass < 200 && remaining.length > 0; pass += 1) {
    const res = (await postAction({
      action: 'bulk_cancel_orders',
      material,
      orderIds: remaining,
    })) as BulkCancelResult & { remaining: number[] };

    result.done.push(...(res.done || []));
    result.failed.push(...(res.failed || []));
    result.skipped.push(...(res.skipped || []));

    const next = res.remaining || [];
    // Ничего не сдвинулось — дальше ходить бессмысленно, иначе зациклимся.
    if (next.length === remaining.length) break;
    remaining = next;
    onProgress?.(total - remaining.length, total);
  }

  return result;
};

export interface TakenOrder {
  id: number;
  orderNumber: string;
  orderType: OrderType;
  marketplace: Marketplace;
  material?: string | null;
  width?: number | null;
  height?: number | null;
  /** Связка Яндекса: вещи одного заказа покупателя вешаются вместе на одну вешалку. */
  groupKey?: string | null;
  groupSize?: number | null;
  groupPosition?: number | null;
  /** Ткань с осыпающимся краем: на листе закройщика печатается метка «ОВЕРЛОК». */
  requiresOverlock?: boolean;
  /**
   * ОТПРАВЛЕНИЯ ОДНОЙ ПОКУПКИ OZON.
   *
   * Покупатель заказал две одинаковые шторы — приходят два разных отправления
   * («…-0186-1» и «…-0186-3») со своими ярлыками. Отгружаются они ПОРОЗНЬ,
   * поэтому это не связка Яндекса: вешать на одну вешалку не нужно.
   *
   * Но вещи часто одинаковые, и на вешалке их не различить — закройщица должна
   * видеть это на листе, чтобы не перепутать бирки.
   */
  purchaseKey?: string | null;
  purchaseSize?: number | null;
  purchasePosition?: number | null;
}

export interface TakeStackResult {
  success: true;
  count: number;
  orderIds: number[];
  orders: TakenOrder[];
}

/**
 * Взять работу в раскрой.
 *
 * @param single взять ОДИН заказ вместо стека. Связки Яндекса при этом пропускаются:
 * заказ покупателя из нескольких вещей раскраивается только целиком, поэтому выдаётся
 * следующий одиночный заказ по очереди.
 */
export const takeStack = (
  userId: number,
  workshopId: number,
  shiftNumber?: number | null,
  single?: boolean,
): Promise<TakeStackResult> =>
  postAction({ action: 'take_stack', userId, workshopId, shiftNumber, single });

export interface TakeOrderResult {
  success: true;
  orderId: number;
  /** Ключ связки, если швея получила заказ Яндекса из нескольких вещей. */
  groupKey?: string | null;
  /** Сколько вещей выдано одним нажатием: связка приходит целиком. */
  takenCount?: number;
}

export const takeOrder = (userId: number): Promise<TakeOrderResult> =>
  postAction({ action: 'take_order', userId });

/**
 * Сколько ещё шить каждую вещь, взятую швеёй в работу.
 *
 * Время задаётся настройками цеха по ШИРИНЕ изделия и отсчитывается от взятия заказа.
 * Пока отсчёт идёт, кнопка «Отправить на стикеровку» у этой вещи заблокирована: сдать
 * её раньше нельзя, а значит и место в работе не освободится.
 *
 * Ключ — id заказа. Вещи, у которых время уже вышло, в ответ не попадают.
 */
export interface SewingWait {
  /** Осталось секунд. */
  waitSeconds: number;
  /** Момент разблокировки (ISO) — по нему фронт тикает сам, не дёргая сервер. */
  nextAt: string | null;
}

export interface SewingWaits {
  waits: Record<string, SewingWait>;
  /** Открыта ли смена: без смены заказы не выдаются вовсе. */
  shiftOpen: boolean;
  /** Сколько заказов у швеи прямо сейчас «В работе». */
  inWork: number;
  /** Предел заказов на руках — настройка цеха. По нему кнопка показывает замочек. */
  maxOrders: number;
}

export const fetchSewingWaits = async (userId: number): Promise<SewingWaits> => {
  const res = await fetch(`${ORDERS_URL}?sewingWaits=1&userId=${userId}`);
  if (!res.ok) return { waits: {}, shiftOpen: true, inWork: 0, maxOrders: 0 };
  const data = await res.json();
  return {
    waits: data.waits || {},
    shiftOpen: data.shiftOpen !== false,
    inWork: Number(data.inWork) || 0,
    maxOrders: Number(data.maxOrders) || 0,
  };
};

// actorId обязателен: по нему сервер проверяет, что тесьму списывает именно швея.
export const sendToStickering = (id: number, rollId?: number, actorId?: number) =>
  postAction({ action: 'send_to_stickering', id, rollId, actorId });

/**
 * ЭТАП ОВЕРЛОКА.
 *
 * takeOverlock — швея с допуском берёт вещь из очереди «Оверлок» себе.
 * overlockDone — край обметан. Куда вещь пойдёт дальше, решает она сама:
 *   'to_sewing' — вернуть в общую очередь «Раскроено» с отметкой «Обработан»,
 *                 дальше её разберут швеи на прямострочку;
 *   'finish'    — работы больше нет, отправить сразу на стикеровку.
 */
export const takeOverlock = (id: number, actorId?: number) =>
  postAction({ action: 'take_overlock', id, actorId });

export const overlockDone = (
  id: number,
  next: 'to_sewing' | 'finish',
  actorId?: number
) => postAction({ action: 'overlock_done', id, next, actorId });

export const cancelOrder = (id: number) => postAction({ action: 'cancel_order', id });

/**
 * Отметить в журнале, что лист закройщика распечатан.
 *
 * Бирка с номером — единственное, чем крой отличается от такого же куска ткани
 * рядом. Когда вещь теряется на вешалке, первый вопрос: печаталась ли бирка? Без
 * этой записи ответа нет нигде, и разбор превращается в гадание.
 *
 * Печати не мешает: ошибку глушим — лист важнее журнала.
 */
export const logPrintSheet = (
  orderIds: number[],
  kind: 'stack' | 'single',
  actorId?: number,
  actorName?: string,
) =>
  postAction({ action: 'log_print_sheet', orderIds, kind, actorId, actorName }).catch(
    () => undefined,
  );