import { useEffect, useState } from 'react';
import { BUBBLE_HATS, BubbleHat } from '@/components/lider/bubbleHats';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

/** Шляпы кейс бокса. На витрине одна картинка и листание: ряд кружков на узком экране не нужен. */
const HatLootCarousel = () => {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = BUBBLE_HATS.length;
  const hat = BUBBLE_HATS[index] || BUBBLE_HATS[0];

  useEffect(() => {
    if (paused || count < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [paused, count]);

  const step = (dir: number) => {
    setIndex((current) => (current + dir + count) % count);
  };

  return (
    <div
      className="relative h-32 shrink-0 bg-[#0b1220]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <p className="pointer-events-none absolute left-3 top-2 z-10 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
        Может выпасть
      </p>
      <div className="flex h-full items-center justify-center px-12 pb-7">
        <div className="h-16 w-24">
          <BubbleHat kind={hat.key} />
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="absolute left-2 top-1/2 h-8 w-8 -translate-y-1/2 border-white/30 bg-white/90 text-slate-900 hover:bg-white"
        onClick={() => step(-1)}
        aria-label="Предыдущая шляпа"
      >
        <Icon name="ChevronLeft" size={16} />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 border-white/30 bg-white/90 text-slate-900 hover:bg-white"
        onClick={() => step(1)}
        aria-label="Следующая шляпа"
      >
        <Icon name="ChevronRight" size={16} />
      </Button>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-col items-center gap-1.5">
        <p className="text-sm font-bold text-white drop-shadow">{hat.title}</p>
        <div className="flex gap-1">
          {BUBBLE_HATS.map((item, i) => (
            <button
              key={item.key}
              type="button"
              aria-label={item.title}
              className={`pointer-events-auto h-1.5 rounded-full ${
                i === index ? 'w-4 bg-amber-300' : 'w-1.5 bg-white/40'
              }`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default HatLootCarousel;
