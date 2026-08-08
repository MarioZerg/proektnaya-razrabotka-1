const REVIEWS_URL = 'https://functions.poehali.dev/085266ac-7c01-408d-9e05-6a1981f3b41d';

export interface Review {
  id: number;
  marketplace: 'OZON' | 'WB';
  rating: number | null;
  text: string | null;
  reviewDate: string | null;
  productName: string | null;
  productSku: string | null;
  orderId: number | null;
  orderNumber: string | null;
  orderType: string | null;
  orderCreatedAt: string | null;
  orderCompletedAt: string | null;
  sewingStatus: string | null;
  cutterName: string | null;
  sewerName: string | null;
  packerName: string | null;
}

export interface EmployeeRating {
  userId: number;
  fullName: string;
  reviewsCount: number;
  avgRating: number | null;
}

export interface RatingResult {
  cutter: EmployeeRating[];
  sewer: EmployeeRating[];
  packer: EmployeeRating[];
}

export interface SyncReviewsResult {
  created: number;
  warnings: string[];
}

export const fetchReviews = async (): Promise<Review[]> => {
  const res = await fetch(REVIEWS_URL);
  const data = await res.json();
  return data.reviews || [];
};

export const fetchReviewsRating = async (): Promise<RatingResult> => {
  const res = await fetch(`${REVIEWS_URL}?action=rating`);
  const data = await res.json();
  return { cutter: data.cutter || [], sewer: data.sewer || [], packer: data.packer || [] };
};

/**
 * Загружает отзывы, проходя весь архив.
 *
 * Отзывов у WB тысячи, и за один запрос они не выгружаются — площадка отдаёт их
 * страницами. Поэтому вызываем синхронизацию по кругу, пока не дойдём до конца.
 * Если очередная страница сорвалась, пробуем её ещё раз: WB иногда отвечает не сразу.
 */
export const syncReviews = async (): Promise<SyncReviewsResult> => {
  let stage = 'false';
  let skip = 0;
  let created = 0;
  const warnings: string[] = [];
  let fails = 0;

  for (let step = 0; step < 80; step += 1) {
    let data: SyncReviewsResult & {
      done?: boolean;
      wbStage?: string;
      wbSkip?: number;
      error?: string;
    };
    try {
      const res = await fetch(REVIEWS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', wbStage: stage, wbSkip: skip }),
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка синхронизации отзывов');
      fails = 0;
    } catch (e) {
      fails += 1;
      if (fails >= 3) {
        if (created === 0) throw e;
        break;
      }
      continue;
    }

    created += data.created || 0;
    for (const w of data.warnings || []) {
      if (!warnings.includes(w)) warnings.push(w);
    }
    if (data.done) break;
    stage = data.wbStage || stage;
    skip = data.wbSkip ?? skip;
  }

  return { created, warnings };
};