import type { RefObject } from 'react';
import { ZONE_H, ZONE_W } from './meterageOcr';

interface MeterageCameraViewProps {
  videoRef: RefObject<HTMLVideoElement>;
  reading: boolean;
  onFocusAtTap: (clientX: number, clientY: number) => void;
}

const MeterageCameraView = ({ videoRef, reading, onFocusAtTap }: MeterageCameraViewProps) => (
  <div
    className="relative h-[42dvh] shrink-0 overflow-hidden rounded-md bg-black sm:h-[280px]"
    onClick={(e) => onFocusAtTap(e.clientX, e.clientY)}
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
);

export default MeterageCameraView;
