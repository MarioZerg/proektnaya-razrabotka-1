import Icon from '@/components/ui/icon';

export type CountTone = 'violet' | 'cyan' | 'white';

/**
 * Цифра на табло.
 *
 * Ключ — само число: когда оно изменилось, табло вспыхивает и увеличивается.
 * Так изменение видно боковым зрением, без сравнения цифр глазами.
 */
const LiveCountBoard = ({
  value,
  tone,
  loading,
  size = 'md',
}: {
  value: number;
  tone: CountTone;
  loading?: boolean;
  /** На телефоне плитки компактнее — маленькое табло. */
  size?: 'sm' | 'md';
}) => {
  const alive = !loading && value > 0;
  // Склад — белая обводка; производство — та же форма, но фуксия (чуть отличить блоки).
  const board =
    tone === 'white'
      ? 'border-2 border-white bg-slate-950 text-white shadow-[0_0_18px_rgba(255,255,255,0.4)]'
      : tone === 'violet'
        ? 'border-2 border-fuchsia-300 bg-violet-950 text-white shadow-[0_0_18px_rgba(232,121,249,0.45)]'
        : 'bg-slate-950 text-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.45)]';
  const glow =
    tone === 'white' ? 'bg-white/35' : tone === 'violet' ? 'bg-fuchsia-400/40' : 'bg-cyan-400/40';
  const idleBoard =
    tone === 'white'
      ? 'border-2 border-slate-300 bg-slate-200 text-slate-400'
      : tone === 'violet'
        ? 'border-2 border-violet-200 bg-slate-200 text-slate-400'
        : 'bg-slate-200 text-slate-400';
  const compact = size === 'sm';

  return (
    <span className="relative inline-flex">
      {alive && (
        <span
          className={`absolute inset-0 animate-breathe rounded-lg blur-md motion-reduce:animate-none ${glow}`}
        />
      )}
      <span
        key={loading ? 'loading' : value}
        className={`relative inline-flex items-center justify-center rounded-lg font-mono-tech font-bold tabular-nums leading-none ${
          compact
            ? 'min-w-[2rem] px-1.5 py-0.5 text-xl sm:min-w-[2.75rem] sm:px-2 sm:py-1 sm:text-3xl'
            : 'min-w-[2.75rem] px-2 py-1 text-3xl'
        } ${
          loading
            ? 'bg-slate-800 text-slate-300'
            : alive
              ? `${board} animate-count-bump`
              : idleBoard
        }`}
      >
        {loading ? (
          <Icon name="Loader2" size={compact ? 16 : 22} className="animate-spin" />
        ) : (
          value
        )}
      </span>
    </span>
  );
};

export default LiveCountBoard;
