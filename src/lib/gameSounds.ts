/**
 * Звуки игр вариков: старт дуэли, победа, звон монет в шахте.
 *
 * FRONTEND-ONLY: короткие wav из public/sounds и запасной WebAudio, если файл
 * не открылся. Облачная функция звук не отдаёт.
 */

const templates: Record<string, HTMLAudioElement> = {};

let audioCtx: AudioContext | null = null;

const ctx = () => {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
};

const tone = (
  ac: AudioContext,
  freq: number,
  when: number,
  dur: number,
  type: OscillatorType,
  gain: number,
) => {
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  amp.gain.setValueAtTime(0.0001, when);
  amp.gain.exponentialRampToValueAtTime(gain, when + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(amp);
  amp.connect(ac.destination);
  osc.start(when);
  osc.stop(when + dur + 0.02);
};

const playFile = (src: string, fallback: () => void) => {
  try {
    if (!templates[src]) {
      const el = new Audio(src);
      el.preload = 'auto';
      templates[src] = el;
    }
    const node = templates[src].cloneNode(true) as HTMLAudioElement;
    node.volume = 1;
    const pending = node.play();
    if (pending && typeof pending.catch === 'function') pending.catch(fallback);
  } catch {
    fallback();
  }
};

const startFallback = () => {
  const ac = ctx();
  if (!ac) return;
  const now = ac.currentTime;
  tone(ac, 196, now, 0.35, 'triangle', 0.12);
  tone(ac, 392, now + 0.28, 0.5, 'triangle', 0.1);
};

const winFallback = () => {
  const ac = ctx();
  if (!ac) return;
  const now = ac.currentTime;
  [523, 659, 784, 1046].forEach((freq, i) => {
    tone(ac, freq, now + i * 0.14, 0.4, 'triangle', 0.1);
  });
};

const coinsFallback = () => {
  const ac = ctx();
  if (!ac) return;
  const now = ac.currentTime;
  [1480, 1860, 1640, 2100, 1720, 1980].forEach((freq, i) => {
    tone(ac, freq, now + i * 0.08, 0.12, 'square', 0.05);
  });
};

/** Горн в момент, когда жребий начал крутиться. */
export const playDuelStart = () => playFile('/sounds/duel-start.wav', startFallback);

/** Фанфары награждения. */
export const playDuelWin = () => playFile('/sounds/duel-win.wav', winFallback);

/** Звон монет, когда швея зачерпнула мешок. */
export const playShaftCoins = () => playFile('/sounds/shaft-coins.wav', coinsFallback);
