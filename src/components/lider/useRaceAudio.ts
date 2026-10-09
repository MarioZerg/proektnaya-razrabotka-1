import { useEffect, useRef } from 'react';

/** Шаги по тропе. Салют и хлыст на карте больше не звучат. */
export const useRaceAudio = (opts: { enabled: boolean; walking: boolean }) => {
  const { enabled, walking } = opts;
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

    const step = () => {
      const t0 = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.035, t0);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.08);
      g.connect(ctx.destination);
      const n = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
      const data = n.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = n;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 140 + Math.random() * 40;
      src.connect(f);
      f.connect(g);
      src.start(t0);
      src.stop(t0 + 0.08);
    };

    const id = walking ? window.setInterval(step, 640) : 0;
    return () => {
      if (id) window.clearInterval(id);
    };
  }, [enabled, walking]);

  useEffect(
    () => () => {
      const ctx = ctxRef.current;
      ctxRef.current = null;
      void ctx?.close();
    },
    [],
  );
};
