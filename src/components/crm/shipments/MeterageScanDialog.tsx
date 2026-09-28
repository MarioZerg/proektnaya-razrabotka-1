import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { formatMeterage, parseMeterageFromOcr } from '@/lib/parseMeterage';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';

/** Доля экрана камеры, совпадает с белой рамкой. Шире, чтобы влезло «50,80». */
const ZONE_W = 0.64;
const ZONE_H = 0.22;

interface MeterageScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Метраж одного рулона, как на бирке: «63,3». */
  onMeterage: (quantity: string) => void;
  /** Последний принятый метраж — кладовщик видит его, пока сканирует дальше. */
  lastQty: string | null;
  /** Убрать последний рулон из приёмки, если скан ошибочный. */
  onUndoLast: () => void;
  /** Какой материал сейчас сканируют — крупно в шапке, чтобы не перепутать ткань. */
  materialName: string;
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
          cachePath: 'meterage-ocr-v4',
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
        tessedit_char_whitelist: '0123456789.,м ',
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

  // Tesseract плохо видит запятую на мелком кадре — увеличиваем зону.
  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = src.width * scale;
  canvas.height = src.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return src;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
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

const cropOverlayFromVideo = (video: HTMLVideoElement) => {
  if (video.readyState < 2 || video.videoWidth < 16) return null;
  const elW = video.clientWidth || video.videoWidth;
  const elH = video.clientHeight || video.videoHeight;
  const cover = visibleCoverRect(elW, elH, video.videoWidth, video.videoHeight);
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
  materialName,
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

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => {
    scanGenRef.current += 1;
    if (!open) {
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
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
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
    setHint(`${shown} м × 1 рулон — в строке. Следующий — снова кнопка`);
    playScanSound();
    onMeterageRef.current(qty);
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
      if (gen !== scanGenRef.current) return;
      const { data } = await workerRef.current.recognize(source);
      if (gen !== scanGenRef.current) return;
      const raw = (data.text || '').replace(/\s+/g, ' ').trim();
      const meters = parseMeterageFromOcr(raw);
      if (meters == null) {
        const seen = raw ? ` Прочитал: «${raw.slice(0, 40)}»` : '';
        setHint(`В рамке нет длины 20–200 м.${seen} Нужно всё число, и запятая тоже`);
        return;
      }
      accept(meters, gen);
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
    const frame = video ? cropOverlayFromVideo(video) : null;
    if (!frame) {
      setHint('Камера ещё не готова — подождите секунду');
      return;
    }
    const gen = ++scanGenRef.current;
    void recognizeZone(frame, gen);
  };

  const lastShown = lastQty ? lastQty.replace('.', ',') : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        confirmClose={false}
        className="z-[60] flex h-[100dvh] max-h-[100dvh] w-full max-w-full left-0 top-0 translate-x-0 translate-y-0 flex-col gap-2 overflow-hidden rounded-none p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-h-[90dvh] sm:w-full sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:p-6 sm:pb-6"
      >
        <DialogHeader className="shrink-0 space-y-1 pr-8 text-left">
          <DialogTitle className="truncate text-xl font-bold leading-tight sm:text-2xl">
            {materialName || 'Сканер метража'}
          </DialogTitle>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Сканер метража · в рамку всё число, и запятая
          </p>
        </DialogHeader>

        {lastShown ? (
          <div className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-muted/60 px-3 py-2.5">
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
                onUndoLast();
                setHint('Рулон убран. Наведите и считайте снова');
              }}
            >
              <Icon name="X" size={22} />
            </Button>
          </div>
        ) : (
          <p className="shrink-0 text-sm text-muted-foreground">
            Ещё нет скана. Наведите на метраж {materialName ? `«${materialName}»` : ''}
          </p>
        )}

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-md bg-black sm:min-h-[260px]">
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

        <p className="shrink-0 text-sm font-medium leading-snug">
          <span className={hint.includes('в строке') ? 'text-emerald-700' : undefined}>{hint}</span>
        </p>

        {camError && <p className="shrink-0 text-sm text-destructive">{camError}</p>}

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
