import type { RadioStation } from '@/lib/radioStations';

/** Знак волны: цвет станции и короткий знак, без чужого товарного знака. */
const RadioLogo = ({ station, size = 56 }: { station: RadioStation; size?: number }) => (
  <span
    className="relative grid shrink-0 place-items-center overflow-hidden rounded-2xl text-white shadow-md"
    style={{ width: size, height: size, background: station.color }}
    aria-hidden
  >
    <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full opacity-35">
      <circle cx="32" cy="40" r="6" fill="none" stroke="white" strokeWidth="3" />
      <path d="M20 32a16 16 0 0 1 24 0" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
      <path d="M12 24a26 26 0 0 1 40 0" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
    </svg>
    <span className="relative text-sm font-black tracking-tight">{station.mark}</span>
  </span>
);

export default RadioLogo;
