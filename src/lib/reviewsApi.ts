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

export const syncReviews = async (): Promise<SyncReviewsResult> => {
  const res = await fetch(REVIEWS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'sync' }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка синхронизации отзывов');
  }
  return data;
};
