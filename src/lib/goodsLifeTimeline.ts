import type {
  GoodsCard,
  GoodsHistoryEntry,
  GoodsLifePoint,
  GoodsOrderOutcome,
  GoodsSupplyLife,
  GoodsWarehouseItem,
  ReturnHistoryEntry,
} from '@/lib/goodsWarehouseApi';
import type { RepairPiece } from '@/lib/repairFabricApi';

/**
 * Точка жизни вещи: отшили, приняли, оформили, отгрузили, вернули, оформили снова.
 *
 * Кладовщик смотрит не журнал действий, а цепочку. Поэтому события из разных
 * источников (даты карточки, журнал, история возвратов) сводятся к одним и тем
 * же видам — и на карточке, и сразу в строке склада.
 */
export type LifeKind =
  | 'cut'
  | 'sewn'
  | 'packed'
  | 'received'
  | 'shelved'
  | 'labeled'
  | 'picked'
  | 'supply'
  | 'shipped'
  | 'sold'
  | 'returned'
  | 'lost'
  | 'sewing'
  | 'repair'
  | 'other';

export interface LifeEvent {
  kind: LifeKind;
  label: string;
  at: string;
  who?: string | null;
  detail?: string | null;
  /** Дата на компактной ленте, если она не совпадает с моментом события (дата поставки). */
  day?: string | null;
}

const KIND_LABEL: Record<LifeKind, string> = {
  cut: 'Раскроили',
  sewn: 'Сшили',
  packed: 'Упаковали',
  received: 'Приняли',
  shelved: 'На полку',
  labeled: 'Оформили',
  picked: 'В подбор',
  supply: 'В поставку',
  shipped: 'Отгрузили',
  sold: 'Выкуплен',
  returned: 'Вернули',
  lost: 'Утерян',
  sewing: 'В пошив',
  repair: 'В куски',
  other: 'Событие',
};

const ACTION_KIND: Record<string, LifeKind> = {
  ship_label: 'labeled',
  start_picking: 'picked',
  scan_picking: 'picked',
  close_shipped: 'shipped',
  close_shipped_stuck: 'shipped',
  receive_return: 'returned',
  scan_return: 'returned',
  admin_receive: 'received',
  place_on_shelf: 'shelved',
  to_shelf_from_inspection: 'shelved',
  mark_lost: 'lost',
  not_found: 'lost',
  send_to_sewing: 'sewing',
  return_to_workshop: 'sewing',
  restore_lost: 'received',
};

const OUTCOME_LABEL: Record<string, string> = {
  stored: 'положили на полку',
  repack: 'перепаковали',
  utilized: 'утилизировали',
};

/** События, которые рисуем в строке склада: цикл отгрузки, а не пошив. */
const ROW_KINDS: LifeKind[] = [
  'received',
  'labeled',
  'picked',
  'supply',
  'shipped',
  'sold',
  'returned',
  'lost',
  'sewing',
  'repair',
];

const DEDUPE_MS = 2 * 60 * 1000;

const ts = (iso: string) => new Date(iso).getTime();

const near = (a: string, b: string) => Math.abs(ts(a) - ts(b)) < DEDUPE_MS;

const push = (out: LifeEvent[], event: LifeEvent) => {
  if (!event.at || Number.isNaN(ts(event.at))) return;
  const dup = out.find((x) => x.kind === event.kind && near(x.at, event.at));
  if (dup) {
    if (!dup.who && event.who) dup.who = event.who;
    if (!dup.detail && event.detail) dup.detail = event.detail;
    return;
  }
  out.push(event);
};

const kindFromHistory = (h: GoodsHistoryEntry): LifeKind => {
  if (h.action === 'stage') {
    const d = h.description || '';
    if (d.startsWith('Раскроен')) return 'cut';
    if (d.startsWith('Отшит')) return 'sewn';
    if (d.startsWith('Упакован')) return 'packed';
    return 'other';
  }
  return ACTION_KIND[h.action] || 'other';
};

const labelOf = (kind: LifeKind, fallback?: string | null) =>
  kind === 'other' ? fallback || KIND_LABEL.other : KIND_LABEL[kind];

const supplyLabel = (scheme?: string | null, number?: string | null) => {
  const bits = [scheme, number].filter(Boolean);
  return bits.length ? `В поставку ${bits.join(' ')}` : KIND_LABEL.supply;
};

const fromPoint = (p: GoodsLifePoint): LifeEvent => {
  const dateBit = p.date ? `поставка ${formatLifeDay(p.date)}` : null;
  return {
    kind: p.kind,
    label: p.kind === 'supply' ? supplyLabel(p.scheme, p.number) : KIND_LABEL[p.kind],
    at: p.at,
    detail: dateBit,
    day: p.date || null,
  };
};

const fromSupply = (s: GoodsSupplyLife): LifeEvent | null => {
  const at = s.scannedAt || s.at || s.shippedAt || s.completedAt;
  if (!at) return null;
  const dateBit = s.supplyDate
    ? `поставка ${formatLifeDay(s.supplyDate)}`
    : s.shippedAt
      ? `отгружена ${formatLifeDay(s.shippedAt)}`
      : null;
  const statusBit = s.status && s.status !== 'Открытая' ? s.status : null;
  return {
    kind: 'supply',
    label: supplyLabel(s.type, s.number),
    at,
    detail: [dateBit, statusBit].filter(Boolean).join(' · ') || null,
    day: s.supplyDate || null,
  };
};

const soldCaption = (o: GoodsOrderOutcome) => {
  const mp = o.ozonStatus === 'delivered' || (o.ymStatus || '').toUpperCase() === 'DELIVERED'
    ? 'доставлен покупателю'
    : o.status === 'Доставлен'
      ? 'доставлен покупателю'
      : 'выкуплен';
  return [o.marketplace, o.orderType, o.orderNumber, mp].filter(Boolean).join(' · ');
};

const fromSold = (o: GoodsOrderOutcome, fallbackAt?: string | null): LifeEvent | null => {
  if (!o.sold) return null;
  const at = o.completedAt || fallbackAt;
  if (!at) return null;
  return {
    kind: 'sold',
    label: KIND_LABEL.sold,
    at,
    detail: soldCaption(o),
  };
};

const fromReturn = (r: ReturnHistoryEntry): LifeEvent | null => {
  if (!r.returnedAt) return null;
  const bits = [
    r.returnNumber ? `№${r.returnNumber}` : null,
    r.marketplace,
    r.orderNumber || r.postingNumber,
    r.returnReason,
    r.outcome ? OUTCOME_LABEL[r.outcome] || r.outcome : null,
  ].filter(Boolean);
  return {
    kind: 'returned',
    label: r.returnNumber ? `Вернули №${r.returnNumber}` : 'Вернули',
    at: r.returnedAt,
    who: r.receivedByName,
    detail: bits.join(' · ') || null,
  };
};

const mergeSort = (events: LifeEvent[]): LifeEvent[] =>
  [...events].sort((a, b) => ts(a.at) - ts(b.at) || a.kind.localeCompare(b.kind));

/**
 * Таймлайн карточки: цех → склад → отгрузка → возврат → оформили снова.
 * Журнал, возвраты и даты карточки дополняют друг друга: если отгрузку не
 * записали в журнал, остаётся shippedAt.
 */
export const lifeFromCard = (
  card: Pick<
    GoodsCard,
    | 'history'
    | 'returns'
    | 'receivedAt'
    | 'shippedAt'
    | 'shippingLabeledAt'
    | 'matchedAt'
    | 'lostAt'
    | 'lostReason'
    | 'receiveReason'
    | 'supplies'
    | 'orderOutcomes'
    | 'supplyNumber'
    | 'supplyType'
    | 'supplyId'
  >,
): LifeEvent[] => {
  const out: LifeEvent[] = [];

  for (const h of card.history || []) {
    if (!h.createdAt) continue;
    const kind = kindFromHistory(h);
    if (kind === 'other') continue;
    push(out, {
      kind,
      label: labelOf(kind, h.description || h.action),
      at: h.createdAt,
      who: h.userName,
      detail:
        h.description && h.description !== labelOf(kind, h.description) ? h.description : null,
    });
  }

  for (const r of card.returns || []) {
    const ev = fromReturn(r);
    if (ev) push(out, ev);
  }

  // received_at после возврата перезаписывается датой приёмки. Если возвраты
  // уже есть в истории, эта дата — дубль последней «Вернули», а не первое
  // появление вещи на складе.
  const hasReturns = (card.returns || []).some((r) => r.returnedAt);
  if (card.receivedAt && !(hasReturns && card.receiveReason === 'return')) {
    const isReturn = card.receiveReason === 'return';
    push(out, {
      kind: isReturn ? 'returned' : 'received',
      label: isReturn ? 'Вернули' : 'Приняли',
      at: card.receivedAt,
    });
  }
  if (card.shippingLabeledAt) {
    push(out, { kind: 'labeled', label: KIND_LABEL.labeled, at: card.shippingLabeledAt });
  }
  if (card.matchedAt) {
    push(out, { kind: 'picked', label: KIND_LABEL.picked, at: card.matchedAt });
  }
  const supplies = card.supplies || [];
  for (const s of supplies) {
    const ev = fromSupply(s);
    if (ev) push(out, ev);
  }
  // Пока облачная функция не отдаёт supplies — хотя бы текущая поставка.
  if (!supplies.length && (card.supplyNumber || card.supplyId) && card.shippedAt) {
    push(out, {
      kind: 'supply',
      label: supplyLabel(card.supplyType, card.supplyNumber),
      at: card.shippedAt,
    });
  }
  for (const o of card.orderOutcomes || []) {
    const ev = fromSold(o, card.shippedAt);
    if (ev) push(out, ev);
  }
  if (card.shippedAt) {
    push(out, { kind: 'shipped', label: KIND_LABEL.shipped, at: card.shippedAt });
  }
  if (card.lostAt) {
    push(out, {
      kind: card.lostReason?.includes('пошив') ? 'sewing' : 'lost',
      label: card.lostReason?.includes('пошив') ? KIND_LABEL.sewing : KIND_LABEL.lost,
      at: card.lostAt,
      detail: card.lostReason,
    });
  }

  return mergeSort(out);
};

/** Компактный таймлайн для строки/карточки списка склада. */
export const lifeFromWarehouseItem = (item: GoodsWarehouseItem): LifeEvent[] => {
  const out: LifeEvent[] = [];

  for (const p of item.life || []) {
    push(out, fromPoint(p));
  }

  // received_at после приёмки возврата затирается её датой. Если история
  // возвратов уже пришла в life — это дубль, второй «Вернули» не рисуем.
  const lifeHasReturns = (item.life || []).some((p) => p.kind === 'returned');
  if (item.receivedAt && item.receiveReason !== 'return') {
    push(out, { kind: 'received', label: KIND_LABEL.received, at: item.receivedAt });
  } else if (item.receivedAt && item.receiveReason === 'return' && !lifeHasReturns) {
    push(out, { kind: 'returned', label: KIND_LABEL.returned, at: item.receivedAt });
  }
  if (item.shippingLabeledAt) {
    push(out, { kind: 'labeled', label: KIND_LABEL.labeled, at: item.shippingLabeledAt });
  }
  if (item.matchedAt) {
    push(out, { kind: 'picked', label: KIND_LABEL.picked, at: item.matchedAt });
  }
  if (
    (item.supplyNumber || item.supplyId) &&
    !(item.life || []).some((p) => p.kind === 'supply')
  ) {
    const at = item.shippedAt || item.shippingLabeledAt || item.matchedAt;
    if (at) {
      push(out, {
        kind: 'supply',
        label: supplyLabel(item.supplyType, item.supplyNumber),
        at,
      });
    }
  }
  if (item.shippedAt) {
    push(out, { kind: 'shipped', label: KIND_LABEL.shipped, at: item.shippedAt });
  }
  if (item.lostAt) {
    push(out, {
      kind: item.lostReason?.includes('пошив') ? 'sewing' : 'lost',
      label: item.lostReason?.includes('пошив') ? KIND_LABEL.sewing : KIND_LABEL.lost,
      at: item.lostAt,
    });
  }

  const numbered = numberReturns(mergeSort(out).filter((e) => ROW_KINDS.includes(e.kind)));
  return numbered;
};

const numberReturns = (events: LifeEvent[]): LifeEvent[] => {
  let n = 0;
  const total = events.filter((e) => e.kind === 'returned').length;
  if (total < 2) return events;
  return events.map((e) => {
    if (e.kind !== 'returned') return e;
    n += 1;
    return { ...e, label: `Вернули ${n}` };
  });
};

/**
 * Кусок — это бывший заказ. Лента та же, что у вещи, плюс «В куски»
 * и раскрой, если отрез уже взяли.
 */
export const lifeFromRepairPiece = (piece: RepairPiece): LifeEvent[] => {
  const out: LifeEvent[] = [];
  if (piece.cutAt) push(out, { kind: 'cut', label: KIND_LABEL.cut, at: piece.cutAt });
  if (piece.sewnAt) push(out, { kind: 'sewn', label: KIND_LABEL.sewn, at: piece.sewnAt });
  if (piece.packedAt) push(out, { kind: 'packed', label: KIND_LABEL.packed, at: piece.packedAt });
  if (piece.receivedAt) {
    push(out, { kind: 'received', label: KIND_LABEL.received, at: piece.receivedAt });
  }
  if (piece.labeledAt) {
    push(out, { kind: 'labeled', label: KIND_LABEL.labeled, at: piece.labeledAt });
  }
  if (piece.shippedAt) {
    push(out, { kind: 'shipped', label: KIND_LABEL.shipped, at: piece.shippedAt });
  }
  if (piece.createdAt) {
    const who =
      piece.addedByRole === 'storekeeper'
        ? 'кладовщик'
        : piece.addedByRole === 'admin'
          ? 'администратор'
          : piece.createdByName || null;
    push(out, {
      kind: 'repair',
      label: KIND_LABEL.repair,
      at: piece.createdAt,
      who: piece.createdByName,
      detail: [piece.reasonLabel, who ? `добавил ${who}` : null].filter(Boolean).join(' · '),
    });
  }
  if (piece.usedAt && piece.status === 'used') {
    push(out, {
      kind: 'cut',
      label: 'Пущен в раскрой',
      at: piece.usedAt,
      who: piece.usedByName,
      detail: piece.usedOrderNumber ? `заказ ${piece.usedOrderNumber}` : null,
    });
  }
  return mergeSort(out);
};

export const formatLifeDay = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/Moscow',
  });

export const lifeKindStyle: Record<
  LifeKind,
  { hex: string; icon: string }
> = {
  cut: { hex: '#f59e0b', icon: 'Scissors' },
  sewn: { hex: '#8b5cf6', icon: 'Shirt' },
  packed: { hex: '#0d9488', icon: 'PackageCheck' },
  received: { hex: '#64748b', icon: 'PackagePlus' },
  shelved: { hex: '#64748b', icon: 'MapPin' },
  labeled: { hex: '#7c3aed', icon: 'Tag' },
  picked: { hex: '#0d9488', icon: 'ScanLine' },
  supply: { hex: '#0369a1', icon: 'Boxes' },
  shipped: { hex: '#0284c7', icon: 'Truck' },
  sold: { hex: '#15803d', icon: 'CheckCheck' },
  returned: { hex: '#d97706', icon: 'Undo2' },
  lost: { hex: '#dc2626', icon: 'PackageX' },
  sewing: { hex: '#c026d3', icon: 'Shirt' },
  repair: { hex: '#7c3aed', icon: 'Scissors' },
  other: { hex: '#64748b', icon: 'Clock' },
};