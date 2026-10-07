import { fetchShipmentDetail, fetchShipments } from '@/lib/shipmentsApi';

const PRODUCT_COST_URL = 'https://functions.poehali.dev/7e85cd3d-e5cd-44e2-a803-5ff07584de12';

/** POEHALI: себестоимость. FRONTEND-ONLY: сбой GET не писать как «тканей не найдено». */

/** Один материал в составе изделия. */
export interface CostMaterial {
  materialId: number;
  name: string;
  /** «Тюль», «Аксессуары», «Упаковка». */
  typeName: string;
  unit: string;
  quantity: number;
  pricePerUnit: number;
  sum: number;
  /** Откуда взята цена: прайс поставщика, рулоны на складе, поставка или нигде. */
  priceSource: 'supplier' | 'rolls' | 'supply' | 'none';
}

/** Фактическая цена метра из принятой поставки. */
export interface MaterialSupplyPrice {
  shipmentId: number;
  completedAt: string | null;
  supplierName: string;
  costPerUnit: number;
  quantity: number;
}

/**
 * Себестоимость сочетания «ткань + ширина».
 *
 * Высота изделия на себестоимость не влияет — кроят, обшивают тесьмой и пакуют
 * по ширине. Поэтому одна такая запись закрывает весь ряд высот.
 */
export interface CostGroup {
  material: string | null;
  width: number | null;
  /** Сколько карточек товара закрывает эта запись (все высоты). */
  productsCount: number;
  materials: CostMaterial[];
  fabricCost: number;
  trimCost: number;
  packCost: number;
  materialsCost: number;
  /** Надбавка на недостачи материалов: обрезки, брак, пересорт. */
  shortageCost?: number;
  /** Процент, по которому посчитана надбавка. */
  shortagePercent?: number;
  cutCost: number;
  sewCost: number;
  packWorkCost: number;
  laborCost: number;
  overhead: number;
  /** Из чего сложились прочие расходы: ручные статьи. */
  overheadExtra?: number;
  /** Вознаграждение менеджера маркетплейсов на одну вещь. */
  overheadManager?: number;
  /** Во сколько вещь обходится цеху. Без налога и комиссии площадки. */
  total: number;
  /** Чего не хватает для честной цифры. */
  missing: string[];
}

/** Статья дополнительных расходов: сумма, поделённая на число вещей. */
export interface ExtraExpense {
  id: number;
  name: string;
  amount: number;
  perItems: number;
  note: string | null;
  isActive: boolean;
  /** Сколько ложится на одну вещь. */
  perUnit: number;
}

export interface CostSettings {
  overheadPerItem: number;
  workshopId: number | null;
  /** Надбавка на недостачи материалов, % от стоимости ткани и упаковки. */
  shortagePercent?: number;
}

/** Продажи одной площадки за период, с разбивкой по схемам. */
export interface SoldByMarketplace {
  marketplace: string;
  /** Продано по факту получения денег, за вычетом возвратов. */
  net: number;
  /** Со склада площадки — товар уходит покупателю без нашего участия. */
  fbo: number;
  /** Со своего склада: собираем и отправляем сами. */
  fbs: number;
  /** Доставлено покупателю — до вычета возвратов. */
  delivered: number;
  /** Вернулось обратно: возвраты, отмены, невыкупы. */
  returned: number;
  /**
   * Откуда цифра: 'marketplace' — из финансовых операций площадки (видны обе
   * схемы), 'orders' — из наших заказов, там только FBS.
   */
  source: 'marketplace' | 'orders';
}

/** Сколько вещей реально продано — подсказка для делителя расходов. */
export interface SoldUnits {
  days: number;
  total: number;
  byMarketplace: SoldByMarketplace[];
}

/** Вознаграждение менеджера маркетплейсов за прошлый месяц. */
export interface ManagerCommission {
  percent: number;
  isActive: boolean;
  /** Кому начисляем — по нему открываем отчёты для выплаты. */
  userId: number | null;
  comment: string | null;
  /** Первое число месяца, за который считаем. */
  month: string;
  monthEnd: string;
  /** Сколько отчётов площадки попало в расчёт. */
  periods: number;
  /** Фактически перечислено на расчётный счёт — база процента. */
  transferred: number;
  /** Расчётная сумма по отчёту: для сверки, но не база. */
  accrued: number;
  /** Агентское вознаграждение — техническая проводка, не деньги. */
  agencyFee: number;
  /** Удержано досрочными выплатами: на процент не влияет. */
  earlyPayout: number;
  payout: number;
  /** Сколько это на одну проданную вещь. */
  perUnit: number | null;
}

export interface CostResponse {
  settings: CostSettings;
  groups: CostGroup[];
  extras: ExtraExpense[];
  workshops: { id: number; name: string }[];
  sold: SoldUnits;
  manager: ManagerCommission | null;
  /** Последние приёмки по id материала — чтобы подставить цену метра в карточку. */
  suppliesByMaterial?: Record<string, MaterialSupplyPrice[]>;
}

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(PRODUCT_COST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

export const fetchProductCosts = async (): Promise<CostResponse> => {
  const res = await fetch(PRODUCT_COST_URL);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить расчёт');
  return data;
};

export const saveCostSettings = (settings: CostSettings & { actorId?: number }) =>
  post({ action: 'save_settings', ...settings });

export const addExtraExpense = (payload: {
  name: string;
  amount: number;
  perItems: number;
  note?: string;
  actorId?: number;
}) => post({ action: 'add_expense', ...payload });

export const updateExtraExpense = (payload: {
  id: number;
  name: string;
  amount: number;
  perItems: number;
  note?: string | null;
  isActive: boolean;
  actorId?: number;
}) => post({ action: 'update_expense', ...payload });

export const deleteExtraExpense = (id: number, actorId?: number) =>
  post({ action: 'delete_expense', id, actorId });

/** Пока облачная функция не отдаёт поставки — собираем их из приёмок. */
export const loadRecentSupplyPrices = async (): Promise<Record<string, MaterialSupplyPrice[]>> => {
  const list = await fetchShipments({ type: 'from_supplier', status: 'Завершено' });
  const map: Record<string, MaterialSupplyPrice[]> = {};
  const details = await Promise.all(list.slice(0, 12).map((s) => fetchShipmentDetail(s.id)));
  for (const detail of details) {
    if (!detail) continue;
    const acc = new Map<number, { weighted: number; qty: number; supplier: string }>();
    for (const it of detail.items || []) {
      if (it.costPerUnit == null || it.materialId == null) continue;
      const qty = it.quantity ?? 0;
      const prev = acc.get(it.materialId) || {
        weighted: 0,
        qty: 0,
        supplier: it.supplierName || detail.supplierName || '—',
      };
      acc.set(it.materialId, {
        weighted: prev.weighted + it.costPerUnit * qty,
        qty: prev.qty + qty,
        supplier: it.supplierName || prev.supplier,
      });
    }
    for (const [mid, v] of acc) {
      const key = String(mid);
      const rows = map[key] || [];
      if (rows.length >= 5) continue;
      rows.push({
        shipmentId: detail.id,
        completedAt: detail.completedAt || detail.createdAt,
        supplierName: v.supplier,
        costPerUnit: v.qty > 0 ? Math.round((v.weighted / v.qty) * 10000) / 10000 : 0,
        quantity: Math.round(v.qty * 100) / 100,
      });
      map[key] = rows;
    }
  }
  return map;
};

export const saveManagerCommission = (payload: {
  percent: number;
  isActive: boolean;
  comment?: string;
  actorId?: number;
}) => post({ action: 'save_manager', ...payload });
