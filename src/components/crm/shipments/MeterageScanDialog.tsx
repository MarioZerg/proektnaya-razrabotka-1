import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { formatMeterage, parseMeterageFromOcr } from '@/lib/parseMeterage';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';

/** Доля экрана камеры, совпадает с белой рамкой. */
const ZONE_W = 0.7;
const ZONE_H = 0.28;

interface MeterageScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Метраж одного рулона, как на бирке: «63,3». */
  onMeterage: (quantity: string) => void;
  /** Последний принятый метраж — кладовщик видит его, пока сканирует дальше. */
  lastQty: string | null;
  /** Убрать последний рулон из приёмки, если скан ошибочный. */
  onUndoLast: () => void;
  unit: string;
}

type TesseractWorker = {
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

const errText = (e: unknown) => {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return 'неизвестная ошибка';
};

const getMeterageWorker = async (): Promise<TesseractWorker> => {
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

const applyCloseFocus = async (stream: MediaStream) => {
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

const binarizeCanvas = (canvas: HTMLCanvasElement) => {
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

const contrastCanvas = (canvas: HTMLCanvasElement) => {
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

const cloneCanvas = (canvas: HTMLCanvasElement) => {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext('2d')?.drawImage(canvas, 0, 0);
  return copy;
};

const cropCanvas = (
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
const visibleCoverRect = (elW: number, elH: number, vidW: number, vidH: number) => {
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

const cropFromVideo = (video: HTMLVideoElement, zoneOnly: boolean) => {
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

/**
 * Камера метража на приёмке. Картинка с камеры только для прицела —
 * цифры читаются по кнопке и только из белой рамки.
 */
const MeterageScanDialog = ({
  open,
  onOpenChange,
  onMeterage,
  lastQty,
  onUndoLast,
  unit,
}: MeterageScanDialogProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<TesseractWorker | null>(null);
  const busyRef = useRef(false);
  const scanGenRef = useRef(0);
  const lockGenRef = useRef(0);
  const onMeterageRef = useRef(onMeterage);
  onMeterageRef.current = onMeterage;

  const [camError, setCamError] = useState<string | null>(null);
  const [hint, setHint] = useState('Цифры метража — в рамку, затем кнопка');
  const [reading, setReading] = useState(false);
  const [ownQty, setOwnQty] = useState<string | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => {
    if (!open) {
      scanGenRef.current += 1;
      stopCamera();
      setCamError(null);
      setHint('Цифры метража — в рамку, затем кнопка');
      setReading(false);
      busyRef.current = false;
      return;
    }

    let cancelled = false;
    setCamError(null);

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError('Камера в этом браузере недоступна');
        return;
      }
      try {
        let stream: MediaStream;
        try {
          const videoConstraints: MediaTrackConstraints & { focusMode?: { ideal: string } } = {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            focusMode: { ideal: 'continuous' },
          };
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: videoConstraints,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        await applyCloseFocus(stream);
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.setAttribute('webkit-playsinline', 'true');
        await video.play();
      } catch {
        if (!cancelled) {
          setCamError('Нет доступа к камере. Разрешите её в браузере');
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      scanGenRef.current += 1;
      stopCamera();
    };
  }, [open]);

  const accept = (meters: number, gen: number) => {
    if (gen !== scanGenRef.current) return;
    const qty = formatMeterage(meters);
    const shown = qty.replace('.', ',');
    setOwnQty(qty);
    setHint(`${shown} ${unit} × 1 — в строке. Следующий — снова кнопка`);
    playScanSound();
    onMeterageRef.current(qty);
  };

  const readOnce = async (worker: TesseractWorker, source: HTMLCanvasElement, psm: string) => {
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(source);
    return (data.text || '').replace(/\s+/g, ' ').trim();
  };

  const recognizeZone = async (source: HTMLCanvasElement, gen: number) => {
    if (busyRef.current) return;
    busyRef.current = true;
    lockGenRef.current = gen;
    setReading(true);
    setHint('Читаю метраж в рамке…');
    try {
      if (!workerRef.current) {
        setHint('Загрузка распознавания…');
        workerRef.current = await getMeterageWorker();
      }
      if (gen !== scanGenRef.current) {
        setHint('Скан сброшен. Нажмите ещё раз');
        return;
      }

      const tryRead = async (img: HTMLCanvasElement, psm: string) => {
        const raw = await readOnce(workerRef.current as TesseractWorker, img, psm);
        if (gen !== scanGenRef.current) return { stale: true as const, raw, meters: null };
        return { stale: false as const, raw, meters: parseMeterageFromOcr(raw) };
      };

      let lastRaw = '';
      const passes: Array<{ img: HTMLCanvasElement; psm: string }> = [
        { img: source, psm: '7' },
        { img: source, psm: '8' },
        { img: source, psm: '6' },
        { img: binarizeCanvas(cloneCanvas(source)), psm: '7' },
      ];
      const video = videoRef.current;
      const wide = video ? cropFromVideo(video, false) : null;
      if (wide) passes.push({ img: wide, psm: '7' });

      for (const pass of passes) {
        const result = await tryRead(pass.img, pass.psm);
        lastRaw = result.raw;
        if (result.stale) {
          setHint('Скан сброшен. Нажмите ещё раз');
          return;
        }
        if (result.meters != null) {
          accept(result.meters, gen);
          return;
        }
      }

      const seen = lastRaw ? `Прочитал: «${lastRaw.slice(0, 48)}»` : 'В рамке пусто — цифры не распознались';
      setHint(`${seen}. В рамку всё число от 20, например 20,8 или 50,8. Коснитесь экрана, чтобы сфокусировать`);
      playScanErrorSound();
    } catch (e) {
      if (gen !== scanGenRef.current) return;
      playScanErrorSound();
      setHint(`Не удалось прочитать (${errText(e)}). Нажмите ещё раз`);
    } finally {
      if (lockGenRef.current === gen) {
        busyRef.current = false;
        setReading(false);
      }
    }
  };

  const handleScanClick = () => {
    if (busyRef.current) return;
    const video = videoRef.current;
    if (!video) {
      setHint('Камера ещё не готова — подождите секунду');
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (busyRef.current) return;
        const frame = cropFromVideo(video, true);
        if (!frame) {
          setHint('Камера ещё не готова — подождите секунду и наведите ближе');
          return;
        }
        const gen = ++scanGenRef.current;
        void recognizeZone(frame, gen);
      });
    });
  };

  const focusAtTap = (clientX: number, clientY: number) => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== 'function') return;
    const rect = video.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height)));
    void track
      .applyConstraints({
        advanced: [{ pointsOfInterest: [{ x, y }] } as unknown as MediaTrackConstraintSet],
      })
      .catch(() => undefined);
    void applyCloseFocus(stream);
  };

  const lastShown = (lastQty || ownQty)?.replace('.', ',') ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        confirmClose={false}
        overlayClassName="z-[60]"
        className="!fixed !left-0 !top-0 !z-[70] flex !h-[100dvh] !max-h-[100dvh] !w-full !max-w-full !translate-x-0 !translate-y-0 flex-col gap-2 overflow-y-auto overflow-x-hidden rounded-none p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:!left-[50%] sm:!top-[50%] sm:!h-auto sm:!max-h-[90dvh] sm:!w-full sm:!max-w-lg sm:!translate-x-[-50%] sm:!translate-y-[-50%] sm:rounded-lg sm:p-6 sm:pb-6"
      >
        <DialogTitle className="sr-only">Метраж</DialogTitle>

        <div className="shrink-0 rounded-md border border-border bg-muted/70 px-3 py-2.5 pr-10">
          {lastShown ? (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground">Последний рулон</p>
                <p className="truncate font-bold tabular-nums leading-none tracking-tight">
                  <span className="text-4xl sm:text-5xl">{lastShown}</span>
                  <span className="ml-1.5 text-xl text-muted-foreground sm:text-2xl">
                    {unit} × 1
                  </span>
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="h-12 w-12 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                title="Убрать этот рулон"
                onClick={() => {
                  setOwnQty(null);
                  onUndoLast();
                  setHint('Рулон убран. Наведите и считайте снова');
                }}
              >
                <Icon name="X" size={22} />
              </Button>
            </div>
          ) : null}
          <p
            className={`text-base font-medium leading-snug ${lastShown ? 'mt-1.5' : ''} ${
              hint.includes('в строке') ? 'text-emerald-700' : 'text-foreground'
            }`}
          >
            {hint}
          </p>
        </div>

        {camError && <p className="shrink-0 text-sm text-destructive">{camError}</p>}

        <div
          className="relative h-[42dvh] shrink-0 overflow-hidden rounded-md bg-black sm:h-[280px]"
          onClick={(e) => focusAtTap(e.clientX, e.clientY)}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="rounded-sm border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
              style={{ width: `${ZONE_W * 100}%`, height: `${ZONE_H * 100}%` }}
            />
          </div>
          {reading && (
            <div className="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
              Читаю…
            </div>
          )}
        </div>

        <Button
          type="button"
          className="h-12 w-full shrink-0"
          disabled={reading}
          onClick={handleScanClick}
        >
          <Icon name="ScanLine" size={16} className="mr-2" />
          Считать штрих-код с метражом
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default MeterageScanDialog;
