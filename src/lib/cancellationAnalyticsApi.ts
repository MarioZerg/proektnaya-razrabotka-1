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
  /**
   * Вероятность (0-100), что за случаем стоит конкурент, а не обычный покупатель.
   * Считается от поведения обычных покупателей в наших же данных, потолок — 95%.
   */
  probability: number;
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
    /** Случаев с вероятностью скупки 70% и выше. */
    highRiskBuyers: number;
    /** Сколько вещей пришлось на такие случаи — цифра ущерба. */
    highRiskItems: number;
    /** Средняя вероятность по этим случаям. */
    avgProbability: number;
  };
  /** Воронка отбора: путь от всех заказов до необъяснимых случаев. */
  funnel: {
    totalItems: number;
    totalAccounts: number;
    steps: { title: string; value: number; share: number; note: string }[];
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
/**
 * Архив с папкой на каждого покупателя: внутри папки — Excel по этому человеку.
 *
 * Функция на сервере живёт 5 секунд, а сборка сотни книг Excel в неё не влезает,
 * поэтому архив приезжает ЧАСТЯМИ: качаем часть за частью, пока сервер не скажет,
 * что это была последняя. Каждая часть — самостоятельный zip, распаковываются они
 * в одну общую папку.
 *
 * onProgress получает номер скачанной части и их общее число — чтобы показать
 * человеку, что процесс идёт, а не завис.
 */
export const downloadCancellationArchive = async (
  days: number,
  minItems: number,
  onlyNever = false,
  onProgress?: (done: number, total: number) => void,
) => {
  let part = 0;
  let total = 1;

  do {
    const res = await fetch(
      `${ANALYTICS_URL}?action=archive&days=${days}&minItems=${minItems}` +
        `&onlyNever=${onlyNever ? 1 : 0}&part=${part}` +
        `&actorRole=${encodeURIComponent(currentRole())}`,
    );
    if (!res.ok) throw new Error('Не удалось собрать архив');

    total = Number(res.headers.get('X-Total-Parts') || 1) || 1;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      total === 1
        ? `pokupateli-${days}-dney.zip`
        : `pokupateli-${days}-dney-chast-${part + 1}-iz-${total}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    part += 1;
    onProgress?.(part, total);
    // Небольшая пауза между частями: браузер не любит, когда несколько файлов
    // просятся на скачивание в одно мгновение, и молча теряет часть из них.
    if (part < total) await new Promise((r) => setTimeout(r, 700));
  } while (part < total);

  return total;
};

/** Одно отправление в карточке покупателя. */
export interface BuyerPosting {
  posting: string;
  createdAt: string | null;
  cancelledAt: string | null;
  ozonStatus: string;
  /** Статус по-русски: файл и карточку читает человек, а не программа. */
  statusLabel: string;
  cancelled: boolean;
  product: string;
  quantity: number | null;
  material: string;
  width: number | null;
  height: number | null;
  sku: string;
}

export interface BuyerCard {
  found: boolean;
  orderKey: string;
  buyer?: CancelledOrder;
  postings?: BuyerPosting[];
}

/**
 * Карточка покупателя по лицевому счёту.
 *
 * История берётся ЦЕЛИКОМ, без ограничения периодом со страницы: раз ищут
 * конкретный счёт, важно увидеть все его заказы, а не только попавшие в фильтр.
 */
export const fetchBuyerCard = async (key: string, days: number): Promise<BuyerCard> => {
  const res = await fetch(
    `${ANALYTICS_URL}?action=buyer&key=${encodeURIComponent(key.trim())}` +
      `&days=${days}&actorRole=${encodeURIComponent(currentRole())}`,
  );
  if (!res.ok) throw new Error('Не удалось найти покупателя');
  const data = await res.json();
  return { ...data, orderKey: data.orderKey || key.trim() };
};
