import { moscowYmd } from '@/lib/dateUtils';

/** Календарный день из даты поставки, без сдвига часового пояса. */
export const shipDay = (value?: string | null) => (value ? String(value).slice(0, 10) : '');

const humanDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-');
  return y && m && d ? `${d}.${m}.${y}` : ymd;
};

const overdueMark = (supplyId: number) => `fbo-overdue:${supplyId}`;

/**
 * Газелька груз уже приняла — дата отгрузки в прошлом это норма, а не просрочка.
 *
 * Принятым считаем груз, если поставка уже отгружена (Отгрузка и дальше),
 * кладовщик отметил отправку в Газельку, или Газелька забирает сама и на
 * заявку назначен водитель. Раньше в такой заявке висело «Отгрузка в Газельку
 * просрочена», хотя короба уже уехали и OZON их принял (#1519).
 */
export const gazelkaCargoAccepted = (s: {
  status?: string | null;
  gazelkaShippedAt?: string | null;
  gazelkaPickup?: boolean | null;
  vehicleAssigned?: boolean;
}) =>
  ['Отгрузка', 'Отгружено', 'Принята', 'Выполнена'].includes(s.status || '') ||
  !!s.gazelkaShippedAt ||
  (!!s.gazelkaPickup && !!s.vehicleAssigned);
const printedMark = (supplyId: number, day: string) => `fbo-ozon-printed:${supplyId}:${day}`;

/**
 * Дата, которая попадёт на лист Газельки.
 * С заявки Газельки — если она есть, иначе та, что менеджер сохранил в поставке.
 */
export const gazelkaShipDay = (planDay?: string | null, savedDay?: string | null) =>
  shipDay(planDay) || shipDay(savedDay);

/**
 * Почему листы Газельки на короба печатать нельзя.
 * Пустая строка — можно: дата есть и она не в прошлом, и менеджер её уже сохранил.
 */
export const gazelkaLabelsHold = (
  planDay: string | null | undefined,
  savedDay: string | null | undefined,
  today = moscowYmd(),
): string | null => {
  const gazelka = shipDay(planDay);
  const saved = shipDay(savedDay);
  const current = gazelka || saved;
  if (!current) {
    return 'Даты отгрузки в Газельку нет. Менеджер ставит её в заявке — без даты листы на короба не печатаем.';
  }
  if (current < today) {
    return `Отгрузка в Газельку ${humanDay(current)} просрочена. Старые листы не скачиваем. Менеджер обновляет в системе дату отгрузки в Газельку и дату таймслота на маркетплейсе — обе должны быть актуальными. После этого кладовщик печатает новые листы на короба.`;
  }
  if (gazelka && saved && gazelka !== saved) {
    return `В Газельке дата отгрузки уже ${humanDay(gazelka)}, а в поставке ещё ${humanDay(saved)}. Менеджер сохраняет новую дату — после этого печатаются новые листы, старые клеить нельзя.`;
  }
  return null;
};

/** Запоминаем, что поставка уже была просрочена — чтобы после смены даты потребовать новые этикетки. */
export const noteOverdueSupply = (supplyId: number, day: string, today = moscowYmd()) => {
  if (!day || day >= today) return;
  try {
    localStorage.setItem(overdueMark(supplyId), day);
  } catch {
    // Память браузера может быть закрыта — тогда предупреждение останется, пока дата в прошлом.
  }
};

/** Кладовщик напечатал свежий комплект этикеток OZON уже на текущую дату отгрузки. */
export const markOzonLabelsPrinted = (supplyId: number, day: string) => {
  if (!day) return;
  try {
    localStorage.setItem(printedMark(supplyId, day), '1');
  } catch {
    // Без записи кнопка отгрузки останется закрытой — это безопаснее, чем отпустить старые этикетки.
  }
};

/**
 * После просрочки Газельки менеджер обязан обновить и таймслот маркетплейса.
 * Пока дата поставки на площадку в прошлом или таймслот пуст — листы и отгрузка закрыты.
 */
export const marketplaceSlotHold = (
  supplyId: number,
  gazelkaDay: string | null | undefined,
  supplyDate: string | null | undefined,
  timeslot: string | null | undefined,
  today = moscowYmd(),
): string | null => {
  const gazelka = shipDay(gazelkaDay);
  if (gazelka) noteOverdueSupply(supplyId, gazelka, today);
  if (!gazelka) return null;
  let wasOverdue = false;
  try {
    wasOverdue = !!localStorage.getItem(overdueMark(supplyId));
  } catch {
    wasOverdue = false;
  }
  // Просроченная дата тоже обязана пройти эту проверку: отметка о просрочке
  // уже стоит, и без актуального слота маркетплейса печать и отгрузка закрыты.
  if (gazelka >= today && !wasOverdue) return null;
  const market = shipDay(supplyDate);
  const slot = (timeslot || '').trim();
  const slotReady = !!(market && market >= today && slot);
  if (gazelka >= today && slotReady) return null;
  if (gazelka < today && slotReady) return null;
  if (gazelka < today) {
    return 'Отгрузка в Газельку просрочена. Менеджер обновляет дату отгрузки в Газельку и дату таймслота на маркетплейсе — обе должны быть актуальными.';
  }
  return 'Дата отгрузки в Газельку уже новая. Осталось проставить в системе актуальную дату и таймслот отгрузки на маркетплейс.';
};

/**
 * Почему FBO ещё нельзя отгрузить: дата просрочена или этикетки OZON не переклеены
 * после того, как менеджер перенёс дату.
 */
export const ozonRestickHold = (
  supplyId: number,
  savedDay: string | null | undefined,
  today = moscowYmd(),
): string | null => {
  const day = shipDay(savedDay);
  if (!day) return null;
  noteOverdueSupply(supplyId, day, today);
  if (day < today) {
    return `Поставка просрочена (${humanDay(day)}). Отгрузить нельзя: на коробах старые этикетки OZON. Сначала менеджер ставит новую дату в Газельке, затем переклейте этикетки OZON.`;
  }
  let wasOverdue = false;
  try {
    wasOverdue = !!localStorage.getItem(overdueMark(supplyId));
  } catch {
    wasOverdue = false;
  }
  if (!wasOverdue) return null;
  let printed = false;
  try {
    printed = localStorage.getItem(printedMark(supplyId, day)) === '1';
  } catch {
    printed = false;
  }
  if (printed) return null;
  return `Дата отгрузки обновлена на ${humanDay(day)}. Отгрузить поставку нельзя, пока не переклеите этикетки OZON на короба. Напечатайте новый комплект и наклейте его вместо старого.`;
};
