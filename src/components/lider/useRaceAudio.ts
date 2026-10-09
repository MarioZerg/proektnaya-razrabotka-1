import { useEffect, useRef } from 'react';

/** Короткие звуки гонки: шаги по тропе, салют у замка, хлыст на лужайке. */
export const useRaceAudio = (opts: {
  enabled: boolean;
  walking: boolean;
  nearCastle: boolean;
  whipping: boolean;
}) => {
  const { enabled, walking, nearCastle, whipping } = opts;
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!enabled) {
      void ctxRef.current?.suspend();
      return;
    }

    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = ctxRef.current || new AC();
    ctxRef.current = ctx;
    void ctx.resume();

    const beep = (freq: number, dur: number, type: OscillatorType, gain: number, noise = false) => {
      const t0 = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      g.connect(ctx.destination);
      if (noise) {
        const n = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
        const data = n.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = n;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = freq;
        src.connect(f);
        f.connect(g);
        src.start(t0);
        src.stop(t0 + dur);
        return;
      }
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      o.connect(g);
      o.start(t0);
      o.stop(t0 + dur);
    };

    const step = () => beep(140 + Math.random() * 40, 0.08, 'triangle', 0.035, true);
    const firework = () => {
      beep(420 + Math.random() * 500, 0.35, 'sine', 0.07, true);
      window.setTimeout(() => beep(180, 0.5, 'sine', 0.045, true), 80);
    };
    const whip = () => {
      beep(90, 0.12, 'sawtooth', 0.05);
      window.setTimeout(() => beep(1800, 0.07, 'square', 0.04, true), 90);
    };

    const ids: number[] = [];
    if (walking) ids.push(window.setInterval(step, 640));
    if (nearCastle) ids.push(window.setInterval(firework, 900));
    if (whipping) ids.push(window.setInterval(whip, 1300));
    if (nearCastle) firework();
    if (whipping) whip();

    return () => {
      ids.forEach((id) => window.clearInterval(id));
    };
  }, [enabled, walking, nearCastle, whipping]);

  useEffect(() => () => {
    const ctx = ctxRef.current;
    ctxRef.current = null;
    void ctx?.close();
  }, []);
};
