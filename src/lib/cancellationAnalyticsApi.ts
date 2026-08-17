const ANALYTICS_URL = 'https://functions.poehali.dev/89778b19-288d-4b45-a9bb-e1e80ac0b285';

/** Покупатель (предположительно) и его поведение за период. */
export interface CancelledOrder {
  /**
   * Первая часть номера отправления OZON — она одинакова во всех покупках одного
   * человека, в том числе сделанных в разные дни. Это и позволяет связать заказы.
   */
  orderKey: string;
  cancelledItems: number;
  /** Сколько вещей реально поехало к покупателю. Ноль — не выкупил ничего. */
  aliveItems: number;
  totalItems: number;
  /** Сколько отдельных заказов сделал за период. */
  ordersCount: number;
  /** В скольких разных днях заказывал. */
  activeDays: number;
  distinctProducts: number;
  firstCreated: string | null;
  lastCreated: string | null;
  lastCancelled: string | null;
  products: string;
  /** Номера отправлений — их и указывают в обращении в поддержку площадки. */
  postings: string;
  /** Через сколько часов после оформления пришла отмена. */
  hoursToCancel: number | null;
  /** Не выкупил ни одной вещи. */
  neverBought: boolean;
  /** Оценка от 0 до 100: насколько похоже на намеренную скупку. */
  risk: number;
  /** Что именно выглядит подозрительно. */
  flags: string[];
}

/** Отмены по дням — видно всплески. */
export interface DailyPoint {
  date: string;
  cancelled: number;
  total: number;
  share: number;
}

export interface CancelledProduct {
  product: string;
  cancelledItems: number;
  orders: number;
}

export interface CancellationReport {
  days: number;
  summary: {
    ordersWithCancels: number;
    cancelledItems: number;
    instantCancels: number;
    massCancels: number;
    /** Покупателей, не выкупивших ничего при двух и более вещах. */
    neverBought: number;
    /** Покупателей, заказавших повторно. */
    repeatBuyers: number;
  };
  orders: CancelledOrder[];
  products: CancelledProduct[];
  daily: DailyPoint[];
}

const currentRole = (): string => {
  try {
    const raw = localStorage.getItem('megatul_user');
    return raw ? JSON.parse(raw).role : '';
  } catch {
    return '';
  }
};

export const fetchCancellationReport = async (
  days: number,
  minItems: number,
  onlyNever = false,
): Promise<CancellationReport> => {
  const res = await fetch(
    `${ANALYTICS_URL}?action=report&days=${days}&minItems=${minItems}` +
      `&onlyNever=${onlyNever ? 1 : 0}` +
      `&actorRole=${encodeURIComponent(currentRole())}`,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить отчёт');
  return data;
};

/** Скачивает готовый Excel-файл с отчётом. */
export const downloadCancellationExcel = async (
  days: number,
  minItems: number,
  onlyNever = false,
) => {
  const res = await fetch(
    `${ANALYTICS_URL}?action=export&days=${days}&minItems=${minItems}` +
      `&onlyNever=${onlyNever ? 1 : 0}` +
      `&actorRole=${encodeURIComponent(currentRole())}`,
  );
  if (!res.ok) throw new Error('Не удалось сформировать файл');

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `otmeny-${days}-dney.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};