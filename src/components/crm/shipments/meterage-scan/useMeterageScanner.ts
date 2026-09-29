import { useEffect, useRef, useState } from 'react';
import { formatMeterage, parseMeterageFromOcr } from '@/lib/parseMeterage';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import {
  applyCloseFocus,
  binarizeCanvas,
  cloneCanvas,
  cropFromVideo,
  errText,
  getMeterageWorker,
  type TesseractWorker,
} from './meterageOcr';

interface UseMeterageScannerArgs {
  open: boolean;
  onMeterage: (quantity: string) => void;
  onUndoLast: () => void;
  unit: string;
}

export const useMeterageScanner = ({
  open,
  onMeterage,
  onUndoLast,
  unit,
}: UseMeterageScannerArgs) => {
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

  const handleUndoLast = () => {
    setOwnQty(null);
    onUndoLast();
    setHint('Рулон убран. Наведите и считайте снова');
  };

  return {
    videoRef,
    camError,
    hint,
    reading,
    ownQty,
    handleScanClick,
    focusAtTap,
    handleUndoLast,
  };
};

export default useMeterageScanner;
