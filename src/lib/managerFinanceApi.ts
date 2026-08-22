const MANAGER_FINANCE_URL =
  'https://functions.poehali.dev/406daf92-dd75-4e27-946d-e90aa720fe70';

/** Начисление за один недельный отчёт площадки. */
export interface ManagerAccrual {
  id: number;
  periodStart: string;
  periodEnd: string;
  /** Вещей закрыто отчётом. */
  units: number;
  /** Перечислено на расчётный счёт — база начисления. */
  baseAmount: number;
  percent: number;
  amount: number;
  /** Сколько приходится на одну вещь. */
  perUnit: number | null;
  /**
   * pending — ждёт денег от площадки, confirmed — готово к выплате,
   * cancelled — аннулировано. Срока проверки нет: возвраты площадка
   * вычитает сама, ещё в своём отчёте.
   */
  status: 'pending' | 'confirmed' | 'cancelled';
  returnedUnits: number;
  returnedAmount: number;
  cancelReason: string | null;
  confirmedAt: string | null;
  /** К выплате за период. */
  net: number;
  /** Вещей продано ниже юнит-экономики — процент с них не платится. */
  lossUnits: number;
  /** На сколько уменьшена база из-за убыточных продаж. */
  lossAmount: number;
  /** База после вычета убыточных — с неё и взят процент. */
  payableBase: number | null;
  /** Когда деньги за период дошли до расчётного счёта. */
  paidOutAt: string | null;
  /** Сколько в базе пришло компенсациями площадки. */
  compensation: number;
  /** Когда вознаграждение передано в зарплату. */
  paidAt: string | null;
  /** По какой площадке начислено: ozon, wildberries, yandex_market. */
  marketplace: string;
  /** Сколько площадка удержала за перевод денег продавцу. */
  withdrawFee: number;
  /** Средняя маржинальность проданного за период, %. */
  avgMargin: number | null;
  /** Какие позиции ушли в минус: с ними менеджеру и работать. */
  lossDetails: {
    material: string;
    width: number;
    price: number;
    lossPerUnit: number;
    units: number;
    lossTotal: number;
  }[];
}

export interface ManagerBalance {
  percent: number;
  /** С какой даты считает система: раньше отчёты сверяются вручную. */
  accrueFrom: string | null;
  /** Готово к выплате: деньги от площадки пришли. */
  confirmed: number;
  cancelled: number;
  /** Посчитано, но деньги ещё на балансе площадки. */
  pending: number;
  items: ManagerAccrual[];
}

/** Что менеджер видит в своих финансах: баланс и недельные отчёты. */
export const fetchManagerBalance = async (
  userId: number,
): Promise<ManagerBalance> => {
  const res = await fetch(
    `${MANAGER_FINANCE_URL}?action=balance&userId=${userId}`,
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить финансы');
  return data;
};

const post = async (payload: Record<string, unknown>) => {
  const res = await fetch(MANAGER_FINANCE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
};

/** Считает новые начисления, применяет возвраты и закрывает холды. */
export const accrueManager = (actorId?: number) =>
  post({ action: 'accrue', actorId });

/** Полный пересчёт — после смены ставки или правил. */
export const recalcManager = (actorId?: number) =>
  post({ action: 'recalc', actorId });

/** Кому начисляем процент и на сколько дней держим холд. */
/** Выплатить вознаграждение по конкретному отчёту — уходит в зарплату. */
export const payManagerAccrual = (accrualId: number, actorId?: number) =>
  post({ action: 'pay', accrualId, actorId });

export const setManagerUser = (payload: {
  userId: number;
  actorId?: number;
}) => post({ action: 'set_user', ...payload });
