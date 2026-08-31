const STAFF_EFFICIENCY_URL = 'https://functions.poehali.dev/cdb282a1-8df9-4ea8-b57d-0e38e50cf53a';

export interface StaffEfficiencyRow {
  userId: number;
  userName: string;
  avatarUrl: string | null;
  /** Сколько вещей сделал за период. */
  items: number;
  /** Погонные метры — привычная для цеха мера объёма. */
  meters: number;
  /**
   * Минуты на одну вещь (медиана). У упаковщиков null: они работают партиями,
   * и время на единицу для них посчитать нечестно.
   */
  medianMinutes: number | null;
  /** Сколько дней человек реально работал — чтобы сравнивать по темпу, а не по стажу. */
  workDays: number;
  perDay: number;
  /** Все возвраты по его вещам, включая отказы покупателя. */
  returnsTotal: number;
  /** Только те, где виновато производство: брак, повреждение, не тот товар. */
  returnsFault: number;
  /** Доля брака от собственной выработки, %. */
  faultRate: number;
}

export interface ReturnReason {
  reason: string;
  count: number;
  isFault: boolean;
}

export interface StaffEfficiencyData {
  sewers: StaffEfficiencyRow[];
  cutters: StaffEfficiencyRow[];
  packers: StaffEfficiencyRow[];
  reasons: ReturnReason[];
  days: number;
  updatedAt: string;
}

export const fetchStaffEfficiency = async (days = 30): Promise<StaffEfficiencyData> => {
  const res = await fetch(`${STAFF_EFFICIENCY_URL}?days=${days}`);
  if (!res.ok) throw new Error('Не удалось загрузить показатели сотрудников');
  return res.json();
};
