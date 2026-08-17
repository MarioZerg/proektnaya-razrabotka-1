const ANALYTICS_URL = 'https://functions.poehali.dev/89778b19-288d-4b45-a9bb-e1e80ac0b285';

/** Заказ маркетплейса, в котором покупатель отменил вещи. */
export interface CancelledOrder {
  /** Номер заказа OZON — общий для всех вещей одной покупки. */
  orderKey: string;
  cancelledItems: number;
  distinctProducts: number;
  firstCreated: string | null;
  lastCancelled: string | null;
  products: string;
  /** Номера отправлений — их и указывают в обращении в поддержку площадки. */
  postings: string;
  /** Через сколько часов после оформления пришла отмена. */
  hoursToCancel: number | null;
  /** Что именно выглядит подозрительно в этом заказе. */
  flags: string[];
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
  };
  orders: CancelledOrder[];
  products: CancelledProduct[];
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
): Promise<CancellationReport> => {
  const res = await fetch(
    `${ANALYTICS_URL}?action=report&days=${days}&minItems=${minItems}` +
      `&actorRole=${encodeURIComponent(currentRole())}`,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить отчёт');
  return data;
};

/** Скачивает готовый Excel-файл с отчётом. */
export const downloadCancellationExcel = async (days: number, minItems: number) => {
  const res = await fetch(
    `${ANALYTICS_URL}?action=export&days=${days}&minItems=${minItems}` +
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
