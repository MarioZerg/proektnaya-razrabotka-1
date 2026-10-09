import { useEffect, useState } from 'react';

const FRAME_W = 1920;
const FRAME_H = 1080;

/** Статичный кадр 1920×1080: на ТВ масштаб 1, на другом экране — вписываем с полями. */
export const useTvCanvas = () => {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const scale = Math.min(size.w / FRAME_W, size.h / FRAME_H);
  const left = (size.w - FRAME_W * scale) / 2;
  const top = (size.h - FRAME_H * scale) / 2;
  // scale(1) всё равно создаёт containing block: в WebView2 из-за этого
  // программный scrollTop у внутренней ленты часто не едет.
  const zoom = Math.abs(scale - 1) < 0.002 ? 1 : scale;
  return { scale: zoom, left, top, frameW: FRAME_W, frameH: FRAME_H };
};
