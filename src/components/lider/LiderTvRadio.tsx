import { useEffect, useRef, useState } from 'react';
import { radioById } from '@/lib/radioStations';
import { fetchTvRadio } from '@/lib/varikiApi';
import RadioLogo from '@/components/crm/variki/radio/RadioLogo';

/**
 * Правый нижний угол телевизора: логотип выбранной волны и дорожка эфира.
 * Звук играет здесь же, из колонок телевизора.
 */
const LiderTvRadio = () => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playingId = useRef('');
  const [stationId, setStationId] = useState('');

  useEffect(() => {
    let stop = false;
    const load = () => {
      fetchTvRadio()
        .then((id) => {
          if (!stop) setStationId(id);
        })
        .catch(() => {
          /* телевизор не гаснет из-за радио */
        });
    };
    load();
    const timer = window.setInterval(load, 8000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  const station = radioById(stationId);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!station) {
      playingId.current = '';
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      return;
    }
    if (playingId.current === station.id) return;
    playingId.current = station.id;
    audio.src = station.stream;
    void audio.play().catch(() => {
      playingId.current = '';
    });
  }, [station]);

  if (!station) return <audio ref={audioRef} />;

  return (
    <>
      <audio ref={audioRef} autoPlay />
      <button
        type="button"
        onClick={() => void audioRef.current?.play()}
        className="absolute bottom-3 right-3 z-30 flex max-w-[min(92%,420px)] items-center gap-3 rounded-2xl border border-white/15 bg-slate-950/80 px-3 py-2 text-left text-white shadow-lg backdrop-blur"
      >
        <RadioLogo station={station} size={64} />
        <span className="min-w-0">
          <span className="block truncate text-lg font-bold leading-tight">{station.name}</span>
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
        </span>
        <style>{`
          @keyframes tv-radio-bar {
            0%, 100% { transform: scaleY(0.28); }
            50% { transform: scaleY(1); }
          }
        `}</style>
      </button>
    </>
  );
};

export default LiderTvRadio;
