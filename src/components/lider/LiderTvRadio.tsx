import type { RadioStation } from '@/lib/radioStations';
import RadioLogo from '@/components/crm/variki/radio/RadioLogo';

/**
 * Правый нижний угол телевизора: логотип волны и дорожка эфира.
 *
 * Плашка шириной с колонку «Только что» и стоит в её нижнем углу, а у
 * колонки снизу оставлено место под плашку. Конвейер, люди и лента событий
 * не закрываются. На кадре пузырей плашка лежит поверх них — она видна.
 */
const LiderTvRadio = ({ station, blocked = false }: { station: RadioStation | null; blocked?: boolean }) => {
  if (!station) return null;
  return (
    <div className="pointer-events-none absolute bottom-3 right-5 z-30 flex w-[400px] max-w-[calc(100%-2.5rem)] items-center gap-3 rounded-2xl border border-white/15 bg-slate-950/85 px-3 py-2 text-white shadow-lg">
      <RadioLogo station={station} size={64} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-lg font-bold leading-tight">{station.name}</span>
        {blocked ? (
          <span className="mt-1 block text-base leading-tight text-amber-300">
            Нажмите на экран, чтобы включить звук
          </span>
        ) : (
        <span className="mt-1 flex h-7 items-end gap-1" aria-hidden>
          {[0, 1, 2, 3, 4, 5, 6].map((bar) => (
            <span
              key={bar}
              className="w-1.5 origin-bottom rounded-full bg-white/90"
              style={{
                height: '100%',
                animation: `tv-radio-bar 0.9s ${bar * 0.12}s ease-in-out infinite`,
              }}
            />
          ))}
        </span>
        )}
      </span>
      <style>{`
        @keyframes tv-radio-bar {
          0%, 100% { transform: scaleY(0.28); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  );
};

export default LiderTvRadio;
