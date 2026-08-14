/**
 * Голосовые уведомления для кладовщика.
 *
 * Их два, и оба сообщают о новой работе, которая появилась сама собой, без действий
 * кладовщика: отменённый заказ приехал из цеха на полку хранения, либо на подбор
 * пришёл новый заказ со склада. Кладовщик в этот момент ходит между стеллажами и на
 * экран не смотрит — поэтому система говорит вслух.
 *
 * Главное правило: сигналы НИКОГДА не накладываются друг на друга.
 *
 *   - Пришло сразу несколько заказов — голос звучит ОДИН раз, а не по разу на заказ.
 *   - Если в один момент появились обе новости, они звучат по очереди: вторая ждёт,
 *     пока договорит первая. Иначе две записи играют одновременно и не разобрать ни одной.
 *   - После сигнала того же вида наступает пауза в минуту: следующее изменение
 *     прозвучит не раньше, чем она кончится. Поток заказов идёт волнами, и без паузы
 *     склад превращался бы в непрерывно бубнящий динамик.
 *
 * Пауза общая на вкладку и переживает переходы между страницами, но не перезагрузку —
 * это осознанно: после F5 кладовщик должен услышать актуальное состояние.
 */

/** Минимальный промежуток между двумя сигналами ОДНОГО вида. */
const COOLDOWN_MS = 60000;

export type WarehouseAlert = 'cancelledToShelf' | 'newPicking';

const SOURCES: Record<WarehouseAlert, string> = {
  /** Отменённый заказ из цеха: упаковщица наклеила складской стикер, вещь едет на полку. */
  cancelledToShelf: '/sounds/cancelled-to-shelf.mp3',
  /** На подбор со склада пришёл новый заказ. */
  newPicking: '/sounds/new-picking.mp3',
};

/** Когда каждый вид сигнала звучал в последний раз — по нему держим минутную паузу. */
const lastPlayedAt: Partial<Record<WarehouseAlert, number>> = {};

/** Прогретые аудиоэлементы: создаём по одному на файл и переиспользуем. */
const cache: Partial<Record<WarehouseAlert, HTMLAudioElement>> = {};

/** Очередь: сюда попадает сигнал, который пришёл, пока играет предыдущий. */
const queue: WarehouseAlert[] = [];
let playing = false;

const getAudio = (alert: WarehouseAlert) => {
  if (!cache[alert]) {
    const el = new Audio(SOURCES[alert]);
    el.preload = 'auto';
    cache[alert] = el;
  }
  return cache[alert]!;
};

const playNext = () => {
  const alert = queue.shift();
  if (!alert) {
    playing = false;
    return;
  }
  playing = true;
  const audio = getAudio(alert);

  // Следующий сигнал запускаем только после того, как этот договорит или сорвётся.
  const done = () => {
    audio.removeEventListener('ended', done);
    audio.removeEventListener('error', done);
    playNext();
  };
  audio.addEventListener('ended', done);
  audio.addEventListener('error', done);

  try {
    audio.currentTime = 0;
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      // Браузер не дал звук (нет разрешения на автовоспроизведение) — не зависаем
      // в очереди навсегда, идём дальше.
      p.catch(done);
    }
  } catch {
    done();
  }
};

/**
 * Сообщить о новой работе голосом.
 *
 * Возвращает true, если сигнал принят, и false — если его проглотила минутная пауза.
 * Вызывать можно сколько угодно часто: лишние вызовы отсекаются здесь.
 */
export const playWarehouseAlert = (alert: WarehouseAlert): boolean => {
  const now = Date.now();
  const last = lastPlayedAt[alert] || 0;
  if (now - last < COOLDOWN_MS) return false;

  // Этот же сигнал уже стоит в очереди и вот-вот прозвучит — второй раз не ставим.
  if (queue.includes(alert)) return false;

  lastPlayedAt[alert] = now;
  queue.push(alert);
  if (!playing) playNext();
  return true;
};

/**
 * Прогрев звуков после первого действия человека на странице.
 *
 * Браузер молчит, пока пользователь ничего не нажал. Кладовщик всё равно кликает по
 * системе в начале смены — на первом же клике подгружаем файлы, чтобы уведомление
 * прозвучало сразу, а не проглотилось.
 */
export const primeWarehouseAlerts = () => {
  try {
    (Object.keys(SOURCES) as WarehouseAlert[]).forEach((alert) => {
      const el = getAudio(alert);
      el.load();
    });
  } catch {
    // Не критично: звук — подсказка, а не условие работы склада.
  }
};
