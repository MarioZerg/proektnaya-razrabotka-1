import func2url from '../../backend/func2url.json';

const URL = (func2url as Record<string, string>).price_robot;

/** Настройки робота: с какой скоростью и до какой маржи вести цены. */
export interface RobotSettings {
  isActive: boolean;
  /** Наблюдение: робот считает и пишет в журнал, но витрину не трогает. */
  dryRun: boolean;
  stepPercent: number;
  stepDays: number;
  runHour: number;
  /** Цель: на сколько процентов всего поднять цены. Дошли — робот встал. */
  targetTotalPercent: number;
  dropPercent: number;
  maxTotalPercent: number;
  /** Сколько дней продаж сравнивать до и после шага. Меньше 3 — шумно. */
  demandWindowDays: number;
  /** Откатывать только после второго падения подряд. Резкое — сразу. */
  requireSecondSignal: boolean;
  updatedAt?: string;
}

/** Один шаг робота: что решил и почему. */
export interface RobotRun {
  ranAt: string;
  /** raise — поднял, rollback — откатил, hold — выждал, stop — цель взята. */
  decision: string;
  reason: string;
  stepPercent: number | null;
  /** Сдвиг цен от старта на момент этого шага, %. */
  driftPercent: number | null;
  unitsAfter: number | null;
  unitsBefore: number | null;
  unitsChange: number | null;
  itemsPushed: number;
  dryRun: boolean;
}

export interface RobotStatus {
  settings: RobotSettings | null;
  /** Насколько цены уже уехали от точки старта, %. */
  driftPercent: number;
  itemsCount: number;
  runs: RobotRun[];
}

const check = async (r: Response) => {
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Ошибка запроса');
  return d;
};

export const fetchRobotStatus = async (
  actorId?: number,
): Promise<RobotStatus> =>
  check(await fetch(`${URL}?action=status&actorId=${actorId ?? ''}`));

export const saveRobotSettings = async (
  s: RobotSettings & { actorId?: number },
): Promise<{ ok: boolean; settings: RobotSettings }> =>
  check(
    await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', ...s }),
    }),
  );

/**
 * Сдвинуть цены вручную, вне расписания робота.
 *
 * Плюс — вверх, минус — вниз. Учитывается в общем счётчике пути к цели:
 * опустили руками на 2% — роботу до цели снова дальше.
 */
export const moveRobotPrices = async (
  step: number,
  note: string,
  actorId?: number,
): Promise<{ reason: string; pushed: number; drift: number; inProgress?: boolean; left?: number }> =>
  check(
    await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'move', step, note, actorId }),
    }),
  );

/**
 * Сдвинуть цены ВЕСЬ ассортимент за одно нажатие.
 *
 * Почему это нужно. Серверу отведено пять секунд на вызов, и весь магазин за
 * раз он отправить не успевает — цены уходят пачками по 60 карточек. Раньше
 * владельцу приходилось жать кнопку снова и снова, пока не кончится очередь:
 * восемьсот карточек — больше десятка нажатий, и легко бросить на середине,
 * оставив магазин с разными ценами.
 *
 * Теперь досыл идёт сам: повторяем вызов, пока сервер не скажет, что очередь
 * пуста, и по ходу сообщаем, сколько карточек уже ушло.
 */
export const moveRobotPricesAll = async (
  step: number,
  note: string,
  actorId?: number,
  onProgress?: (pushed: number, left: number) => void,
): Promise<{ reason: string; pushed: number; drift: number }> => {
  let last = await moveRobotPrices(step, note, actorId);

  // Счётчик сервера УЖЕ НАКОПИТЕЛЬНЫЙ: он возвращает, сколько ушло с начала
  // шага (60, потом 120, потом 180...). Складывать эти ответы нельзя — так
  // получается сумма ряда: на 674 карточках выходило «изменено 4634».
  // Просто берём последнее значение, оно и есть итог.
  //
  // Предохранитель от бесконечного круга: даже на самом большом ассортименте
  // пачек по 60 хватит с запасом, а зациклиться на ошибке сервера нельзя.
  for (let guard = 0; last.inProgress && last.left && guard < 200; guard++) {
    onProgress?.(last.pushed || 0, last.left);
    last = await moveRobotPrices(step, note, actorId);
  }

  return last;
};

/** Прогнать цикл сейчас, не дожидаясь ночного запуска. */
export const runRobotNow = async (
  actorId?: number,
): Promise<{ decision: string; reason: string; pushed: number }> =>
  check(
    await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'run', actorId, force: true }),
    }),
  );
