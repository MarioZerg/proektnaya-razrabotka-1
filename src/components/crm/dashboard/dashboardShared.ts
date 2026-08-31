/**
 * Куда относится показатель: к пути вещи по цеху или к работе склада.
 *
 * Плитки стояли в порядке добавления: пошив, потом поставки материала, потом
 * снова раскрой — нужную приходилось искать глазами. Дробить их на семь мелких
 * заголовков тоже плохо: в каждом по одной плитке, и дашборд превращается в
 * лестницу. Поэтому делим на два блока.
 *
 * production — единая лента по ходу дела: новые задания → в закрое → раскроено
 * → в пошиве → на стикеровке. Порядок задаётся списком PRODUCTION_FLOW ниже,
 * без промежуточных заголовков: вещь идёт по цеху непрерывно, и читаться это
 * должно так же.
 *
 * warehouse — всё, что делает склад: материалы, отгрузка, возвраты. Это уже
 * другая работа и, как правило, другой человек.
 */
export type DashboardStage = 'attention' | 'production' | 'warehouse';

/** Заголовки блоков и их порядок на дашборде. */
export const STAGE_ORDER: { key: DashboardStage; title: string; icon: string }[] = [
  { key: 'attention', title: 'Требует внимания', icon: 'TriangleAlert' },
  { key: 'production', title: 'Производство', icon: 'Factory' },
  { key: 'warehouse', title: 'Работа со складом', icon: 'Warehouse' },
];

/**
 * Порядок плиток внутри блока «Производство» — по названиям, ровно как вещь
 * движется по цеху. Сравниваем по началу названия: у швеи и закройщика те же
 * плитки подписаны иначе («У меня в пошиве» вместо «Товары в пошиве»).
 */
export const PRODUCTION_FLOW = [
  'Новые задания',
  'в закрое',
  'Раскроено',
  'в пошиве',
  'на стикеровке',
];

/** Место плитки в производственной цепочке; неизвестные уходят в конец. */
export const productionOrder = (label: string) => {
  const i = PRODUCTION_FLOW.findIndex((part) => label.includes(part));
  return i === -1 ? PRODUCTION_FLOW.length : i;
};

export interface DashboardWidgetData {
  label: string;
  value: number;
  icon: string;
  tone: 'default' | 'warning' | 'urgent';
  path: string;
  /** Блок дашборда, в который попадёт плитка. */
  stage: DashboardStage;
  /**
   * Короткая подпись под заголовком: что это за цифра и что с ней делать. Из одного
   * названия это не всегда понятно — «Раскроено» не говорит, ждёт ли работа
   * человека или это просто итог за день.
   */
  hint?: string;
}

/** Порог малого остатка рулона для виджета дашборда — меньше 20 пог.м. (только рулоны в п.м.). */
export const ROLL_LOW_STOCK_THRESHOLD = 20;

export { formatDateTime, formatTime } from '@/lib/dateUtils';

export const formatMoney = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });