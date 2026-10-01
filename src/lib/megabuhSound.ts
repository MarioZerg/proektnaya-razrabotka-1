const SRC = '/sounds/megabuh-reply.wav';

/**
 * Сигнал «МЕГАБУХ ответил» в чате бухгалтера.
 *
 * FRONTEND-ONLY: короткий файл из public/sounds и запасной WebAudio.
 * Браузер молчит без жеста человека, поэтому прогреваем звук в момент отправки
 * вопроса — тогда сигнал после ответа не проглотится политикой автовоспроизведения.
 */

let audio: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;

const getCtx = () => {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
};

const getAudio = () => {
  if (!audio) {
    audio = new Audio(SRC);
    audio.preload = 'auto';
    audio.loop = false;
  }
  return audio;
};

/** Двухтональный «готово»: восходящий сигнал, не похож на скан склада. */
const chimeFallback = () => {
  try {
    const ctx = getCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const tone = (freq: number, start: number, dur: number, peak: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(peak, now + start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    };
    tone(880, 0, 0.18, 0.22);
    tone(1318.5, 0.09, 0.26, 0.26);
  } catch {
    // Сигнал — подсказка, чат работает и без него.
  }
};

/**
 * Жест отправки вопроса: грузим файл и открываем аудиоконтекст,
 * чтобы play() после ответа сети уже не блокировался.
 */
export const primeMegabuhSound = () => {
  try {
    const el = getAudio();
    el.load();
    el.muted = true;
    const pending = el.play();
    if (pending && typeof pending.then === 'function') {
      pending
        .then(() => {
          el.pause();
          el.currentTime = 0;
          el.muted = false;
        })
        .catch(() => {
          el.muted = false;
        });
    } else {
      el.muted = false;
    }
    getCtx();
  } catch {
    // Не критично: если прогрев не вышел, сработает запасной тон.
  }
};

/** Короткий сигнал, что МЕГАБУХ дописал ответ и его можно читать. */
export const playMegabuhReplySound = () => {
  try {
    const el = getAudio();
    if (el.readyState > 0) el.currentTime = 0;
    const pending = el.play();
    if (pending && typeof pending.catch === 'function') pending.catch(chimeFallback);
  } catch {
    chimeFallback();
  }
};
