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
  /** Реально получается раз в столько минут — по числу запусков за сутки. */
  factEveryMin: number | null;
  /** Задание приходит заметно чаще, чем задумано: ошибка в расписании. */
  tooOften: boolean;
  /** Во сколько лишних вызовов в месяц обходится эта ошибка. */
  extraPerMonth: number;
  /** Что задание нашло в последний раз. */
  lastResult: string | null;
  /**
   * ok — работает, late — молчит слишком долго, never — не запускалось ни разу,
   * unknown — ночное задание, может законно молчать (тревогой не считается).
   */
  state: 'ok' | 'late' | 'never' | 'unknown';
  /** Готовая ссылка для планировщика. Приходит ТОЛЬКО админу: внутри ключ запуска. */
  url: string | null;
  /** GET — обычная ссылка. POST — нужен метод POST и тело запроса. */
  method: 'GET' | 'POST';
  /** Тело запроса для POST-задания. Для обычных ссылок — null. */
  body: string | null;
}

/** Раздел страницы: задания сгруппированы по смыслу работы. */
export interface SchedulerGroup {
  key: string;
  title: string;
  /** Чем грозит, если задания раздела перестанут работать. */
  hint: string;
}

export const fetchSchedulerStatus = async (
  actorId?: number,
): Promise<{
  items: SchedulerJob[];
  groups: SchedulerGroup[];
  problems: number;
  /** Сколько заданий бьют чаще нормы. */
  tooOftenCount: number;
  /** Суммарно лишних вызовов в месяц из-за неверного расписания. */
  extraPerMonthTotal: number;
  /** Видны ли ссылки запуска: только администратору. */
  canSeeUrls: boolean;
}> => {
  const res = await fetch(
    actorId ? `${SCHEDULER_STATUS_URL}?actorId=${actorId}` : SCHEDULER_STATUS_URL,
  );
  if (!res.ok) throw new Error('Не удалось загрузить состояние заданий');
  return res.json();
};