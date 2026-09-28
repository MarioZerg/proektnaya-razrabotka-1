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

interface MeterageScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Метраж одного рулона, как на бирке: «63,3». */
  onMeterage: (quantity: string) => void;
}

type TesseractWorker = {
  setParameters: (p: Record<string, string>) => Promise<unknown>;
  recognize: (image: HTMLCanvasElement | File | Blob) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

let sharedBoot: Promise<TesseractWorker> | null = null;

const errText = (e: unknown) => {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return 'неизвестная ошибка';
};

/**
 * Один воркер на вкладку: ядро ~15 МБ, повторно качать при каждом открытии камеры
 * нельзя. Если загрузка сорвалась — следующий заход пробует снова.
 */
const getMeterageWorker = async (): Promise<TesseractWorker> => {
  if (!sharedBoot) {
    sharedBoot = (async () => {
      const tessMod = (await import(
        /* @vite-ignore */ `${window.location.origin}/ocr/tesseract.esm.min.js`
      )) as {
        createWorker?: typeof import('tesseract.js').createWorker;
        default?: { createWorker?: typeof import('tesseract.js').createWorker };
      };
      const createWorker = tessMod.createWorker ?? tessMod.default?.createWorker;
      if (typeof createWorker !== 'function') {
        throw new Error('createWorker is not a function');
      }
      const origin = window.location.origin;
      const worker = (await Promise.race([
        createWorker('eng', 1, {
          gzip: false,
          workerBlobURL: false,
          cachePath: 'meterage-ocr-v3',
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
      ])) as unknown as TesseractWorker;
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789.,мmМ ',
      });
      return worker;
    })().catch((e) => {
      sharedBoot = null;
      throw e;
    });
  }
  return sharedBoot;
};

/**
 * Камера метража на приёмке.
 *
 * Кладовщик наводит телефон на цифры на бирке рулона. Распознавание идёт на
 * устройстве, без сервера: в строку приёмки сразу падает длина одного рулона,
 * камера остаётся открытой на следующий.
 */
const MeterageScanDialog = ({ open, onOpenChange, onMeterage }: MeterageScanDialogProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<TesseractWorker | null>(null);
  const busyRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const onMeterageRef = useRef(onMeterage);
  onMeterageRef.current = onMeterage;

  const [camError, setCamError] = useState<string | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [hint, setHint] = useState('Наведите рамку на цифры метража');
  const [reading, setReading] = useState(false);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => {
    if (!open) {
      stopCamera();
      setCamError(null);
      setHint('Наведите рамку на цифры метража');
      setReading(false);
      busyRef.current = false;
      return;
    }

    let cancelled = false;
    setCamError(null);

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError('Камера в этом браузере недоступна — снимите фото кнопкой ниже');
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
          setCamError('Нет доступа к камере. Разрешите её в браузере или снимите фото');
        }
      }
    };

    void start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEngineReady(false);
    setEngineError(null);
    setHint('Загрузка распознавания…');

    void getMeterageWorker()
      .then((worker) => {
        if (cancelled) return;
        workerRef.current = worker;
        setEngineReady(true);
        setHint('Наведите рамку на цифры метража');
      })
      .catch((e) => {
        if (!cancelled) {
          setEngineError(
            `Не удалось загрузить распознавание (${errText(e)}). Откройте камеру ещё раз`,
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const grabVideoFrame = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || video.videoWidth < 16) return null;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const cw = Math.max(160, Math.floor(w * 0.78));
    const ch = Math.max(80, Math.floor(h * 0.28));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(
      video,
      Math.floor((w - cw) / 2),
      Math.floor((h - ch) / 2),
      cw,
      ch,
      0,
      0,
      cw,
      ch,
    );
    return canvas;
  };

  const accept = (meters: number) => {
    const qty = formatMeterage(meters);
    cooldownUntilRef.current = Date.now() + 1600;
    const shown = qty.replace('.', ',');
    setHint(`${shown} м — в строке. Наведите на следующий рулон`);
    playScanSound();
    onMeterageRef.current(qty);
  };

  const recognizeSource = async (source: HTMLCanvasElement | File) => {
    const worker = workerRef.current;
    if (!worker || busyRef.current) return;
    if (Date.now() < cooldownUntilRef.current) return;
    busyRef.current = true;
    setReading(true);
    try {
      const { data } = await worker.recognize(source);
      const meters = parseMeterageFromOcr(data.text || '');
      if (meters == null) {
        setHint('Цифры не разобрались — ближе к бирке, без блика');
        return;
      }
      accept(meters);
    } catch {
      playScanErrorSound();
      setHint('Не удалось прочитать кадр — снимите ещё раз');
    } finally {
      busyRef.current = false;
      setReading(false);
    }
  };

  useEffect(() => {
    if (!open || !engineReady || camError) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const frame = grabVideoFrame();
      if (frame) void recognizeSource(frame);
      timer = window.setTimeout(tick, 1100);
    };
    let timer = window.setTimeout(tick, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, engineReady, camError]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!engineReady) {
      setHint('Подождите, распознавание ещё загружается');
      return;
    }
    cooldownUntilRef.current = 0;
    await recognizeSource(file);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        confirmClose={false}
        className="z-[60] max-h-[100dvh] max-w-lg gap-3 sm:max-h-[90dvh]"
      >
        <DialogHeader>
          <DialogTitle>Сканер метража</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Наведите камеру на цифры длины на бирке рулона. Кадр читается сам — после
          удачного считывания можно сразу следующий рулон.
        </p>

        <div className="relative overflow-hidden rounded-md bg-black">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="aspect-[3/4] w-full object-cover sm:aspect-video"
          />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-[28%] w-[78%] rounded-sm border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
          {(reading || !engineReady) && (
            <div className="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
              {engineReady ? 'Читаю…' : 'Загрузка…'}
            </div>
          )}
        </div>

        <p className="min-h-10 text-sm font-medium">
          <span className={hint.includes('в строке') ? 'text-emerald-700' : undefined}>{hint}</span>
        </p>

        {camError && <p className="text-sm text-destructive">{camError}</p>}
        {engineError && <p className="text-sm text-destructive">{engineError}</p>}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            type="button"
            variant="secondary"
            className="h-11"
            disabled={!engineReady || reading}
            onClick={() => {
              const frame = grabVideoFrame();
              if (frame) {
                cooldownUntilRef.current = 0;
                void recognizeSource(frame);
              } else {
                setHint('Камера ещё не готова — подождите секунду');
              }
            }}
          >
            <Icon name="ScanLine" size={16} className="mr-2" />
            Считать кадр
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={!engineReady || reading}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="Camera" size={16} className="mr-2" />
            Снять фото
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            void handleFile(file);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};

export default MeterageScanDialog;
