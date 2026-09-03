import fetchWithRetry from '@/lib/fetchWithRetry';

const SHIFT_SESSIONS_URL = 'https://functions.poehali.dev/6143d29d-094c-4dc6-a520-eb0eeb10d8a0';

export interface EmployeeShiftStatus {
  id: number;
  fullName: string;
  role: string;
  shiftNumber: number | null;
  isOpen: boolean;
  openedAt: string | null;
  canCloseAt: string | null;
  /** Гостевой режим — сотрудник не привязан жёстко к штатной смене. */
  shiftFree: boolean;
  /** Цех/смена ТЕКУЩЕЙ открытой смены — может отличаться от штатной (workshop/shiftNumber
   * профиля), если сотрудник зашёл гостем в другую смену. */
  sessionWorkshopId: number | null;
  sessionShiftNumber: number | null;
  /** Оклад за смену для повременных ролей (кладовщик, уборщица). У сдельщиков пусто. */
  shiftRate?: number | null;
  /** График по профилю: с какого по какое время смена. */
  shiftFrom?: string | null;
  shiftTo?: string | null;
  /** Должность, в которой сотрудник работает в текущей открытой смене. */
  sessionRole?: string | null;
  /** Название цеха, в котором сотрудник работает прямо сейчас. */
  sessionWorkshopName?: string | null;
  /** Штатный цех сотрудника из его профиля. */
  homeWorkshopName?: string | null;
  /** Сотрудник вышел в чужой цех — работает гостем. */
  isGuest?: boolean;
}

/** Гостевая смена: сотрудник выходил работать в чужой цех. */
export interface GuestShiftSession {
  id: number;
  fullName: string;
  role: string;
  /** Штатный цех сотрудника. */
  homeWorkshopName: string;
  /** Цех, в который он вышел. */
  workshopName: string;
  shiftNumber: number | null;
  openedAt: string;
  closedAt: string | null;
}

/** История гостевых смен за последние дни — кто и в какой чужой цех выходил. */
export const fetchGuestShiftHistory = async (days = 30): Promise<GuestShiftSession[]> => {
  const res = await fetch(`${SHIFT_SESSIONS_URL}?guest_history=1&days=${days}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось загрузить историю');
  return data.sessions || [];
};

export const fetchEmployeeShifts = async (): Promise<EmployeeShiftStatus[]> => {
  const res = await fetch(SHIFT_SESSIONS_URL);
  const data = await res.json();
  return data.employees || [];
};

export interface ShiftCalendarDay {
  date: string;
  employees: string[];
  activeShift: number | null;
}

export const fetchShiftCalendar = async (month: string): Promise<ShiftCalendarDay[]> => {
  const res = await fetch(`${SHIFT_SESSIONS_URL}?calendar=1&month=${month}`);
  const data = await res.json();
  return data.days || [];
};

/**
 * Статусы смен и календарь — ОДНИМ запросом.
 *
 * Главная спрашивала это двумя отдельными обращениями к одной и той же функции.
 * Смена начинается тем, что все разом открывают главную: база получала от
 * каждого планшета пачку запросов сразу и упиралась в предел одновременных
 * подключений — часть людей вместо смен видела пустой экран.
 *
 * Календарь нужен не всем ролям, поэтому месяц передаётся по желанию: без него
 * ответ прежний, только статусы.
 */
export const fetchShiftsWithCalendar = async (
  month?: string,
): Promise<{ employees: EmployeeShiftStatus[]; days: ShiftCalendarDay[] }> => {
  const qs = month ? `?withCalendar=${month}` : '';
  const res = await fetchWithRetry(`${SHIFT_SESSIONS_URL}${qs}`);
  const data = await res.json();
  return { employees: data.employees || [], days: data.days || [] };
};

export interface AvailableShift {
  workshopId: number;
  workshopName: string;
  shiftNumber: number;
  shiftName: string;
  isHome: boolean;
}

export const fetchAvailableShifts = async (userId: number): Promise<AvailableShift[]> => {
  const res = await fetch(`${SHIFT_SESSIONS_URL}?available_shifts=1&userId=${userId}`);
  const data = await res.json();
  return data.shifts || [];
};

const postAction = async (payload: Record<string, unknown>) => {
  const res = await fetch(SHIFT_SESSIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Ошибка запроса');
  }
  return data;
};

export interface OpenShiftResult {
  id: number;
  openedAt: string;
  workshopId: number;
  shiftNumber: number;
  /** Смена открыта позже начала рабочего дня — зафиксировано опоздание. */
  isLate?: boolean;
  /**
   * Во сколько смену можно будет закрыть: время прихода плюс длительность смены
   * по графику. До этого момента кнопка закрытия на терминале неактивна.
   */
  canCloseAt?: string | null;
  /** На сколько минут сотрудник опоздал к началу смены. */
  lateMinutes?: number;
  /** Сколько удержано за опоздание, рублей. */
  penaltyAmount?: number;
  /** Во сколько смена должна была начаться по графику. */
  shiftStart?: string | null;
}

export const openShift = (
  userId: number,
  workshopId?: number | null,
  shiftNumber?: number | null,
  openedByAdmin?: boolean,
  /** Должность, в которой сотрудник выходит в эту смену (из его разрешённых ролей). */
  role?: string | null
): Promise<OpenShiftResult> =>
  postAction({ action: 'open', userId, workshopId, shiftNumber, openedByAdmin, role });

/** Переносит открытую смену сотрудника в другой цех — когда он перешёл работать туда
 * посреди дня. Смена не закрывается и не открывается заново: она одна на рабочий день. */
export const moveShiftToWorkshop = (
  userId: number,
  workshopId: number
): Promise<{ success: boolean; moved: boolean; workshopId?: number; shiftNumber?: number }> =>
  postAction({ action: 'move_workshop', userId, workshopId });

/** Закрывает смену. Швее, закройщику и упаковщице нельзя, пока за ними числится
 * незавершённая работа — придёт ошибка с её количеством.
 *
 * Принудительно закрыть может только администратор: сервер сам проверяет роль того,
 * кто закрывает (actorId), а не верит флагу из браузера. */
export const closeShift = (userId: number, closedByAdmin = false, actorId?: number) =>
  postAction({
    action: 'close',
    userId,
    ...(closedByAdmin ? { closedByAdmin: true } : {}),
    ...(actorId ? { actorId } : {}),
  });

export interface AutoClosedShift {
  userId: number;
  name: string;
  ordersInWork: number;
  penalty: number;
}

/** Закрывает смены, которые сотрудники забыли закрыть: время берётся из настроек цеха
 * (конец рабочего дня), при заказах в работе начисляется повышенный штраф. */
export const autoCloseShifts = (): Promise<{
  success: true;
  closedCount: number;
  closed: AutoClosedShift[];
}> => postAction({ action: 'auto_close' });
export interface DefectCheck {
  ask: boolean;
  question: string;
  hint: string;
  defectsCount: number;
  defectsQuantity: number;
  role: string;
}

/** Перед закрытием смены спрашиваем про брак: текст свой для каждой роли — закройщик режет
 * ткань, швея работает с тесьмой. Нулевой счётчик обычно значит, что человек забыл оформить
 * брак, а не что его не было. */
export const checkShiftDefects = async (userId: number): Promise<DefectCheck | null> => {
  const res = await fetch(SHIFT_SESSIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'defect_check', userId }),
  });
  const data = await res.json();
  return data.ask ? data : null;
};
/** Пункт чек-листа кладовщика на смену. */
export interface StorekeeperTask {
  key: string;
  title: string;
  hint: string;
  /** Сколько работы осталось. 0 — ничего не висит. */
  count: number;
  done: boolean;
  /** Куда идти делать это задание. */
  link: string;
  /** Закрывается галочкой вручную: система проверить это не может. */
  manual: boolean;
  /** Мешает закрыть смену, пока не выполнено. */
  blocking: boolean;
  /**
   * Работы по этому делу за смену не появлялось: поставок не создавали, возвраты
   * не приезжали. Не выполненное задание и не висящее — показываем бледной
   * строкой без галочки и смену оно не держит.
   */
  idle?: boolean;
  /**
   * Задание копится только до 15:00: работа, пришедшая позже, попадёт уже в
   * список следующего дня. Так у смены появляется финиш — иначе перед уходом
   * кладовщику прилетала новая работа и закрыть список было невозможно.
   */
  cutoff?: boolean;
  /** 15:00 уже прошло: список зафиксирован и дальше только уменьшается. */
  cutoffPassed?: boolean;
  /** Кто взял это задание на себя сегодня. */
  claimedBy?: number;
  claimedByName?: string;
  /** Задание взял ДРУГОЙ кладовщик: трогать нельзя, смену оно не держит. */
  claimedByOther?: boolean;
  /** Администратор закрыл задание за кладовщика — нештатная ситуация, работа
   *  физически ещё не сделана (count это отражает), но смену больше не держит. */
  adminClosed?: boolean;
}

export interface StorekeeperTasksResult {
  shiftOpen: boolean;
  /** Демо-просмотр без открытой смены: галочки живут только на экране. */
  demo?: boolean;
  sessionId?: number;
  tasks: StorekeeperTask[];
  doneCount?: number;
  totalCount?: number;
  /** Сколько заданий прямо сейчас держат смену. */
  blockingCount?: number;
}

/**
 * Чек-лист кладовщика на текущую смену.
 *
 * Пока смена не открыта, заданий нет: список привязан к смене, а не к дате —
 * у человека может быть две смены за день, и галочки одной не должны закрывать
 * задания в другой.
 */
export const fetchStorekeeperTasks = async (
  userId: number,
  demo = false,
): Promise<StorekeeperTasksResult> => {
  const res = await fetch(
    `${SHIFT_SESSIONS_URL}?storekeeperTasks=1&userId=${userId}${demo ? '&demo=1' : ''}`,
  );
  if (!res.ok) return { shiftOpen: false, tasks: [] };
  const data = await res.json();
  return { shiftOpen: !!data.shiftOpen, tasks: data.tasks || [], ...data };
};

/**
 * Отметить галочкой задание, которое система проверить не может: отгрузку ткани
 * (материала может не быть) и напоминание закройщикам про рулоны. Повторное
 * нажатие снимает галочку — отметить по ошибке не страшно.
 */
/** Взять задание на себя (или отпустить повторным нажатием). Если его уже взял
 *  другой кладовщик — вернётся ошибка с его именем. */
export const claimStorekeeperTask = async (
  userId: number,
  taskKey: string,
): Promise<{ claimed: boolean }> => {
  const res = await fetch(SHIFT_SESSIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'claim_task', userId, taskKey }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось взять задание');
  return data;
};

export const toggleStorekeeperTask = async (
  userId: number,
  taskKey: string,
): Promise<{ done: boolean }> => {
  const res = await fetch(SHIFT_SESSIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'toggle_task', userId, taskKey }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось отметить задание');
  return data;
};

/**
 * Администратор закрывает пункт чек-листа кладовщика ЗА него — для нештатных
 * ситуаций (работа висит, а разобраться с причиной сейчас нельзя), чтобы человек
 * мог закрыть смену. Отметка живёт только в рамках текущей открытой смены
 * кладовщика: завтра, в новой смене, чек-лист посчитается заново с нуля.
 * Повторный вызов снимает отметку.
 */
export const adminCloseStorekeeperTask = async (
  userId: number,
  taskKey: string,
  actorId: number,
): Promise<{ closed: boolean }> => {
  const res = await fetch(SHIFT_SESSIONS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'admin_close_task', userId, taskKey, actorId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Не удалось закрыть задание');
  return data;
};