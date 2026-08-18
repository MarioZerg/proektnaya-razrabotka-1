/**
 * Анимация гидромассажа на карточке подарка: вода на дне и всплывающие пузырьки.
 *
 * Живая картинка нужна не ради красоты: подарок стоит 8000 вариков — это месяцы
 * работы, и карточка должна выглядеть как награда, а не как строка прайса.
 *
 * Пузырьки расставлены и запущены с разной задержкой вручную, а не случайно:
 * при случайных значениях они пересобирались на каждой перерисовке и дёргались.
 */
const BUBBLES = [
  { left: '12%', size: 10, delay: '0s', duration: '4.5s' },
  { left: '26%', size: 6, delay: '1.2s', duration: '5.2s' },
  { left: '38%', size: 14, delay: '0.6s', duration: '4s' },
  { left: '52%', size: 8, delay: '2.1s', duration: '5.6s' },
  { left: '64%', size: 11, delay: '1.6s', duration: '4.3s' },
  { left: '78%', size: 7, delay: '0.3s', duration: '5.9s' },
  { left: '88%', size: 12, delay: '2.6s', duration: '4.8s' },
];

const SpaAnimation = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden">
    {/* Лёгкая водная дымка ко дну. Держим её слабой: поверх фотографии плотная
        заливка «топила» картинку — лица и салона было почти не разглядеть. */}
    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-100/10 to-sky-300/25" />

    {/* Две волны друг за другом, с разной скоростью — вода выглядит объёмной. */}
    <div className="absolute inset-x-0 bottom-0 h-14 animate-wave rounded-[50%] bg-sky-400/20 blur-sm" />
    <div
      className="absolute inset-x-0 bottom-0 h-8 animate-wave rounded-[50%] bg-cyan-300/25 blur-[2px]"
      style={{ animationDelay: '1.5s' }}
    />

    {BUBBLES.map((b, i) => (
      <span
        key={i}
        className="absolute bottom-0 animate-bubble rounded-full bg-white/70 ring-1 ring-white/80"
        style={{
          left: b.left,
          width: b.size,
          height: b.size,
          animationDelay: b.delay,
          animationDuration: b.duration,
        }}
      />
    ))}
  </div>
);

export default SpaAnimation;
