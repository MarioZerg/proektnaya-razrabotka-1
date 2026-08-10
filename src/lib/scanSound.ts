// Звуки сканирования штрихкода — используются во всех местах, где сотрудник сканирует
// штрихкод/номер для добавления позиции (рулон, заказ и т.д.) в систему.
//
// Сигнал для кладовщика важнее картинки на экране: он собирает контейнер, смотрит на
// вещь и на полку, а не в монитор. Поэтому звук должен срабатывать НА КАЖДЫЙ скан,
// даже когда сканы идут очередью по несколько штук в секунду.

/** Заранее прогретые «образцы» — клонируем их, чтобы сигналы не обрывали друг друга. */
const templates: Record<string, HTMLAudioElement> = {};

/** Запасной синтезированный сигнал, если mp3 не проиграется (файл не отдался и т.п.). */
let audioCtx: AudioContext | null = null;

const beep = (frequency: number, duration: number, type: OscillatorType = 'square') => {
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === 'suspended') void audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    // Плавное затухание: резкий обрыв щёлкает в динамике.
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch {
    // Звук — приятное дополнение, а не условие работы: молчим и не ломаем сканирование.
  }
};

/**
 * Играет короткий сигнал.
 *
 * Клонируем элемент на каждый вызов: если переиспользовать один и тот же, второй скан
 * обрывает первый на полуслове и кладовщик слышит вместо двух сигналов один огрызок.
 * Если файл не проиграется — синтезируем сигнал сами, чтобы сканер никогда не «онемел».
 */
const play = (src: string, fallback: () => void) => {
  try {
    if (!templates[src]) {
      const el = new Audio(src);
      el.preload = 'auto';
      templates[src] = el;
    }
    const node = templates[src].cloneNode(true) as HTMLAudioElement;
    node.volume = 1;
    const p = node.play();
    if (p && typeof p.catch === 'function') p.catch(fallback);
  } catch {
    fallback();
  }
};

/**
 * Разогрев звука при открытии окна сканера.
 *
 * Браузер блокирует автовоспроизведение, пока пользователь ничего не нажал на странице.
 * Открытие окна — это как раз клик, поэтому здесь разрешение уже есть: прогреваем файлы
 * и аудиоконтекст заранее, чтобы ПЕРВЫЙ же скан прозвучал, а не проглотился.
 */
export const primeScanSounds = () => {
  try {
    ['/sounds/scan-beep.mp3', '/sounds/scan-error.mp3'].forEach((src) => {
      if (!templates[src]) {
        const el = new Audio(src);
        el.preload = 'auto';
        el.load();
        templates[src] = el;
      }
    });
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor) {
      if (!audioCtx) audioCtx = new Ctor();
      if (audioCtx.state === 'suspended') void audioCtx.resume();
    }
  } catch {
    // Не критично: сканирование работает и без предварительного прогрева.
  }
};

/** Успешный скан: товар найден. Короткий высокий сигнал. */
export const playScanSound = () => {
  play('/sounds/scan-beep.mp3', () => beep(1180, 0.12));
};

/** Ошибка скана: товар не найден, чужой или уже принят. Низкий двойной сигнал. */
export const playScanErrorSound = () => {
  play('/sounds/scan-error.mp3', () => {
    beep(240, 0.18, 'sawtooth');
    window.setTimeout(() => beep(180, 0.26, 'sawtooth'), 190);
  });
};

// Открытие и закрытие смены на терминале цеха звучат по-разному: сотрудник понимает
// на слух, что именно произошло, не вчитываясь в экран планшета.

export const playShiftOpenSound = () => {
  play('/sounds/shift-open.mp3', () => beep(880, 0.16, 'sine'));
};

export const playShiftCloseSound = () => {
  play('/sounds/shift-close.mp3', () => beep(440, 0.22, 'sine'));
};