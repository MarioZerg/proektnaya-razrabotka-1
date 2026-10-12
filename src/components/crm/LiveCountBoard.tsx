import Icon from '@/components/ui/icon';

export type CountTone = 'violet' | 'cyan';

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
}: {
  value: number;
  tone: CountTone;
  loading?: boolean;
}) => {
  const alive = !loading && value > 0;
  const board =
    tone === 'cyan'
      ? 'bg-slate-950 text-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.45)]'
      : 'bg-violet-950 text-fuchsia-200 shadow-[0_0_16px_rgba(192,132,252,0.45)]';

  return (
    <span className="relative inline-flex">
      {alive && (
        <span
          className={`absolute inset-0 animate-breathe rounded-lg blur-md motion-reduce:animate-none ${
            tone === 'cyan' ? 'bg-cyan-400/40' : 'bg-fuchsia-400/40'
          }`}
        />
      )}
      <span
        key={loading ? 'loading' : value}
        className={`relative inline-flex min-w-[2.75rem] items-center justify-center rounded-lg px-2 py-1 font-mono-tech text-3xl font-bold tabular-nums leading-none ${
          loading ? 'bg-slate-800 text-slate-300' : alive ? `${board} animate-count-bump` : 'bg-slate-200 text-slate-400'
        }`}
      >
        {loading ? <Icon name="Loader2" size={22} className="animate-spin" /> : value}
      </span>
    </span>
  );
};

export default LiveCountBoard;
