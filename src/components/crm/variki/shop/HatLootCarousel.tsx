import { useEffect, useState } from 'react';
import { BUBBLE_HATS, BubbleHat } from '@/components/lider/bubbleHats';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from '@/components/ui/carousel';

/** Шляпы, которые могут выпасть из кейс бокса. Крутятся сами, стрелки листают вручную. */
const HatLootCarousel = () => {
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => setIndex(api.selectedScrollSnap());
    onSelect();
    api.on('select', onSelect);
    return () => {
      api.off('select', onSelect);
    };
  }, [api]);

  useEffect(() => {
    if (!api || paused) return;
    const timer = window.setInterval(() => api.scrollNext(), 2200);
    return () => window.clearInterval(timer);
  }, [api, paused]);

  const hat = BUBBLE_HATS[index] || BUBBLE_HATS[0];

  return (
    <div
      className="relative h-44 shrink-0 bg-[#0b1220]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <p className="pointer-events-none absolute left-3 top-2 z-10 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
        Может выпасть
      </p>
      <Carousel setApi={setApi} opts={{ loop: true }} className="h-full">
        <CarouselContent className="ml-0 h-44">
          {BUBBLE_HATS.map((item) => (
            <CarouselItem key={item.key} className="flex h-44 basis-full flex-col items-center justify-end pb-10 pl-0">
              <div className="relative h-24 w-28">
                <div className="absolute bottom-0 left-1/2 h-16 w-16 -translate-x-1/2 rounded-full bg-slate-700 ring-4 ring-sky-400" />
                <div className="absolute bottom-10 left-1/2 w-24 -translate-x-1/2">
                  <BubbleHat kind={item.key} />
                </div>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <CarouselPrevious className="left-2 top-1/2 border-white/30 bg-white/90 text-slate-900 hover:bg-white" />
        <CarouselNext className="right-2 top-1/2 border-white/30 bg-white/90 text-slate-900 hover:bg-white" />
      </Carousel>
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
              onClick={() => api?.scrollTo(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default HatLootCarousel;
