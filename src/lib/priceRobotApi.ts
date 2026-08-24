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
): Promise<{ reason: string; pushed: number; drift: number }> =>
  check(
    await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'move', step, note, actorId }),
    }),
  );

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
