const SCHEDULER_STATUS_URL = 'https://functions.poehali.dev/28ee919b-a6b3-4f53-9efb-d53ce1c8ca63';

/**
 * Фоновое задание планировщика.
 *
 * Задания запускает внешний сервис по ссылке — система не дёргает их сама. Поэтому
 * важен не факт «настроено», а факт «отработало»: если планировщик отключат, внешне
 * всё выглядит нормально, а заказы просто перестают приходить.
 */
export interface SchedulerJob {
  key: string;
  title: string;
  /** Зачем это задание нужно — понятным языком. */
  purpose: string;
  /** Раздел страницы: orders — приём заказов, cancels — отмены, service — склад и цех. */
  group: string;
  /** Как часто задание должно запускаться, минут. */
  everyMin: number;
  lastRunAt: string | null;
  /** Сколько минут назад отработало. null — не запускалось ни разу. */
  minutesAgo: number | null;
  runsPerDay: number;
  /** Что задание нашло в последний раз. */
  lastResult: string | null;
  /**
   * ok — работает, late — молчит слишком долго, never — не запускалось ни разу,
   * unknown — ночное задание, может законно молчать (тревогой не считается).
   */
  state: 'ok' | 'late' | 'never' | 'unknown';
}

/** Раздел страницы: задания сгруппированы по смыслу работы. */
export interface SchedulerGroup {
  key: string;
  title: string;
  /** Чем грозит, если задания раздела перестанут работать. */
  hint: string;
}

export const fetchSchedulerStatus = async (): Promise<{
  items: SchedulerJob[];
  groups: SchedulerGroup[];
  problems: number;
}> => {
  const res = await fetch(SCHEDULER_STATUS_URL);
  if (!res.ok) throw new Error('Не удалось загрузить состояние заданий');
  return res.json();
};