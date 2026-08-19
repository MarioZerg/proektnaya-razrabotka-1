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
  /** Фотография подарка. Показывается вместо иконки, если задана. */
  imageUrl?: string | null;
  /** Сколько всего сертификатов задумано (null — без ограничения). */
  stockLimit?: number | null;
  /** Куда прийти с сертификатом и куда звонить записываться. */
  orgAddress?: string | null;
  orgPhone?: string | null;
  /** Период продажи. Оба пустые — бессрочно. Формат ГГГГ-ММ-ДД. */
  validFrom?: string | null;
  validTo?: string | null;
  /** Сколько сертификатов свободно ПРЯМО СЕЙЧАС — столько и можно купить. */
  available: number;
  /** Только во вкладке управления. */
  isActive?: boolean;
  issued?: number;
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
  /** Контакты организации: куда идти с сертификатом и куда звонить. */
  orgAddress?: string | null;
  orgPhone?: string | null;
}

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(VARIKI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  // Ответ бывает НЕ json: при слишком большом теле запроса шлюз отвечает своей
  // ошибкой (413) ещё до функции, и res.json() падал с невнятным «Ошибка запроса».
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }
  if (!res.ok) {
    // 413 и 503 без внятного тела — это шлюз отказал из-за размера запроса,
    // функция до него даже не дошла. Показываем причину, а не код ошибки.
    if (res.status === 413 || (res.status === 503 && !data.error)) {
      throw new Error('файл слишком большой, до 2,5 МБ');
    }
    throw new Error(
      (data.error as string) || `Ошибка запроса (код ${res.status})`,
    );
  }
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
    /** Сертификат нашёлся на складе и выдан сразу — ждать администратора не нужно. */
    instant: boolean;
    couponUrl: string | null;
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

/** Товары магазина глазами администратора — включая снятые с продажи. */
export const fetchShopManage = async (actorId?: number): Promise<ShopItem[]> => {
  const res = await fetch(`${VARIKI_URL}?manage=1&actorId=${actorId ?? ''}`);
  const data = res.ok ? await res.json() : {};
  return data.items || [];
};

export interface SaveItemPayload {
  itemId?: number;
  title: string;
  description?: string | null;
  price: number;
  imageUrl?: string | null;
  icon?: string;
  animation?: string;
  stockLimit?: number | null;
  isActive?: boolean;
  orgAddress?: string | null;
  orgPhone?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}

export const saveShopItem = (payload: SaveItemPayload, actorId?: number) =>
  postAction({ action: 'save_item', ...payload, actorId }) as Promise<{ id: number }>;

/**
 * Загрузка готовых сертификатов: после неё покупка выдаёт файл мгновенно.
 *
 * Файлы уходят ПО ОДНОМУ, а не пачкой в одном запросе. У сервера есть предел на
 * размер запроса (~3 МБ), и пачка из нескольких PDF в него не влезала: загрузка
 * обрывалась ошибкой ещё до функции. По одному — каждый файл заведомо проходит,
 * а если один окажется битым, остальные всё равно загрузятся.
 */
export const uploadCertificates = async (
  itemId: number,
  files: { fileBase64: string; fileName: string }[],
  actorId?: number,
  actorName?: string,
): Promise<{ saved: number; available: number; errors: string[] }> => {
  let saved = 0;
  let available = 0;
  const errors: string[] = [];

  for (const file of files) {
    try {
      const res = (await postAction({
        action: 'upload_certificates',
        itemId,
        files: [file],
        actorId,
        actorName,
      })) as { saved: number; available: number };
      saved += res.saved || 0;
      available = res.available ?? available;
    } catch (e) {
      errors.push(`${file.fileName}: ${e instanceof Error ? e.message : 'ошибка'}`);
    }
  }

  return { saved, available, errors };
};
