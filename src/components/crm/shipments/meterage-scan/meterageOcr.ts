/** Доля экрана камеры, совпадает с белой рамкой. */
export const ZONE_W = 0.7;
export const ZONE_H = 0.28;

export type TesseractWorker = {
  setParameters: (p: Record<string, string>) => Promise<unknown>;
  recognize: (image: HTMLCanvasElement | File | Blob) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

type CreateWorker = (
  langs: string,
  oem: number,
  options: Record<string, unknown>,
) => Promise<TesseractWorker>;

let sharedBoot: Promise<TesseractWorker> | null = null;

export const errText = (e: unknown) => {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return 'неизвестная ошибка';
};

export const getMeterageWorker = async (): Promise<TesseractWorker> => {
  if (!sharedBoot) {
    sharedBoot = (async () => {
      const tessMod = (await import(
        /* @vite-ignore */ `${window.location.origin}/ocr/tesseract.esm.min.js`
      )) as { createWorker?: CreateWorker; default?: { createWorker?: CreateWorker } };
      const createWorker = tessMod.createWorker ?? tessMod.default?.createWorker;
      if (typeof createWorker !== 'function') {
        throw new Error('createWorker is not a function');
      }
      const origin = window.location.origin;
      const worker = await Promise.race([
        createWorker('eng', 1, {
          gzip: false,
          workerBlobURL: false,
          cachePath: 'meterage-ocr-v5',
          cacheMethod: 'write',
          logger: () => undefined,
          errorHandler: () => undefined,
          workerPath: `${origin}/ocr/worker.min.js`,
          corePath: `${origin}/ocr`,
          langPath: `${origin}/ocr`,
        }),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('timeout')), 60000);
        }),
      ]);
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789.,м øØ∅⌀',
        tessedit_pageseg_mode: '7',
      });
      return worker;
    })().catch((e) => {
      sharedBoot = null;
      throw e;
    });
  }
  return sharedBoot;
};

export const applyCloseFocus = async (stream: MediaStream) => {
  const track = stream.getVideoTracks()[0];
  if (!track || typeof track.getCapabilities !== 'function') return;
  const caps = track.getCapabilities() as MediaTrackCapabilities & {
    focusMode?: string[];
    zoom?: { min: number; max: number };
  };
  const advanced: Record<string, unknown> = {};
  if (caps.focusMode?.includes('continuous')) advanced.focusMode = 'continuous';
  else if (caps.focusMode?.includes('single-shot')) advanced.focusMode = 'single-shot';
  if (caps.zoom && caps.zoom.max > 1.15) {
    advanced.zoom = Math.min(2, Math.max(caps.zoom.min ?? 1, 1.3));
  }
  if (Object.keys(advanced).length === 0) return;
  try {
    await track.applyConstraints({
      advanced: [advanced as unknown as MediaTrackConstraintSet],
    });
  } catch {
    /* iOS часто не даёт сменить фокус из браузера */
  }
};

export const binarizeCanvas = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let sum = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
    sum += g;
  }
  const thresh = sum / n * 0.92;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] < thresh ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
};

export const contrastCanvas = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const span = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - min) / span) * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
};

export const cloneCanvas = (canvas: HTMLCanvasElement) => {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext('2d')?.drawImage(canvas, 0, 0);
  return copy;
};

export const cropCanvas = (
  source: CanvasImageSource,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number,
) => {
  if (srcW < 8 || srcH < 8) return null;
  const src = document.createElement('canvas');
  src.width = Math.max(8, Math.round(srcW));
  src.height = Math.max(8, Math.round(srcH));
  const srcCtx = src.getContext('2d');
  if (!srcCtx) return null;
  srcCtx.drawImage(source, srcX, srcY, srcW, srcH, 0, 0, src.width, src.height);

  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = src.width * scale;
  canvas.height = src.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return contrastCanvas(src);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return contrastCanvas(canvas);
};

/**
 * Зона рамки в пикселях исходного кадра. Учитывает object-cover: то, что
 * видно в белой рамке, и то, что уходит в OCR, — одно и то же.
 */
export const visibleCoverRect = (elW: number, elH: number, vidW: number, vidH: number) => {
  const scale = Math.max(elW / vidW, elH / vidH);
  const visW = elW / scale;
  const visH = elH / scale;
  return {
    x: (vidW - visW) / 2,
    y: (vidH - visH) / 2,
    w: visW,
    h: visH,
    scale,
  };
};

export const cropFromVideo = (video: HTMLVideoElement, zoneOnly: boolean) => {
  if (video.readyState < 2 || video.videoWidth < 16) return null;
  const elW = video.clientWidth;
  const elH = video.clientHeight;
  if (elW < 16 || elH < 16) return null;
  const cover = visibleCoverRect(elW, elH, video.videoWidth, video.videoHeight);
  if (!zoneOnly) {
    return cropCanvas(video, cover.x, cover.y, cover.w, cover.h);
  }
  const zoneW = cover.w * ZONE_W;
  const zoneH = cover.h * ZONE_H;
  return cropCanvas(
    video,
    cover.x + (cover.w - zoneW) / 2,
    cover.y + (cover.h - zoneH) / 2,
    zoneW,
    zoneH,
  );
};
