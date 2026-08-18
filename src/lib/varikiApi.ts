const VARIKI_URL = 'https://functions.poehali.dev/2ad91f9f-97d9-46d1-a9f4-06ee696d5ec5';

export interface MyVariki {
  variki: number;
  threshold: number;
  canPlay: boolean;
}

export interface VarikiPlayer {
  id: number;
  fullName: string;
  role: string;
  variki: number;
  canPlay: boolean;
}

export const fetchMyVariki = async (userId: number): Promise<MyVariki> => {
  const res = await fetch(`${VARIKI_URL}?userId=${userId}`);
  return res.json();
};

export const fetchVarikiPlayers = async (): Promise<{ players: VarikiPlayer[]; threshold: number }> => {
  const res = await fetch(`${VARIKI_URL}?players=1`);
  const data = await res.json();
  return { players: data.players || [], threshold: data.threshold || 0 };
};

export const debitVariki = async (userId: number, amount: number, actorId?: number) => {
  const res = await fetch(VARIKI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'debit', userId, amount, actorId }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Не удалось списать варики');
  }
  return data;
};

/** Подарок на витрине магазина вариков. */
export interface ShopItem {
  id: number;
  title: string;
  description: string | null;
  price: number;
  /** Ключ анимации на карточке: 'spa' — гидромассаж. */
  animation: string;
  icon: string;
}

export type PurchaseStatus = 'pending' | 'issued' | 'cancelled';

export interface VarikiPurchase {
  id: number;
  itemId?: number;
  userId?: number;
  userName?: string | null;
  title: string;
  price: number;
  status: PurchaseStatus;
  createdAt: string | null;
  couponUrl: string | null;
  couponName: string | null;
  couponAt: string | null;
  cancelReason: string | null;
}

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(VARIKI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

/** Витрина магазина и покупки самого сотрудника. */
export const fetchShop = async (
  userId?: number,
): Promise<{ items: ShopItem[]; balance: number; purchases: VarikiPurchase[] }> => {
  const res = await fetch(`${VARIKI_URL}?shop=1${userId ? `&userId=${userId}` : ''}`);
  const data = res.ok ? await res.json() : {};
  return {
    items: data.items || [],
    balance: data.balance || 0,
    purchases: data.purchases || [],
  };
};

/** Все покупки — рабочий список администратора (кому ещё не выдан купон). */
export const fetchAllPurchases = async (
  actorId?: number,
): Promise<{ purchases: VarikiPurchase[]; pendingCount: number }> => {
  const res = await fetch(`${VARIKI_URL}?purchases=1&actorId=${actorId ?? ''}`);
  const data = res.ok ? await res.json() : {};
  return { purchases: data.purchases || [], pendingCount: data.pendingCount || 0 };
};

export const buyShopItem = (userId: number, itemId: number) =>
  postAction({ action: 'buy', userId, itemId }) as Promise<{
    purchaseId: number;
    variki: number;
    title: string;
  }>;

/** Админ прикрепляет PDF-купон к покупке — после этого его видит сотрудник. */
export const attachCoupon = (
  purchaseId: number,
  fileBase64: string,
  fileName: string,
  actorId?: number,
  actorName?: string,
) =>
  postAction({
    action: 'attach_coupon',
    purchaseId,
    fileBase64,
    fileName,
    actorId,
    actorName,
  }) as Promise<{ couponUrl: string }>;

/** Отмена покупки с возвратом вариков сотруднику. */
export const cancelPurchase = (
  purchaseId: number,
  reason: string,
  actorId?: number,
  actorName?: string,
) => postAction({ action: 'cancel_purchase', purchaseId, reason, actorId, actorName });
