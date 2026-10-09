import { BubbleHat } from '@/components/lider/bubbleHats';
import type { TvDuel } from '@/lib/varikiApi';

const initials = (name: string) =>
  name.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase();

const timeLeft = (iso: string | null | undefined) => {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return days > 0 ? `${days} д ${hours} ч` : `${Math.max(1, hours)} ч`;
};

const Portrait = ({
  name,
  avatarUrl,
  hatKey,
}: {
  name: string;
  avatarUrl?: string | null;
  hatKey: string | null;
}) => (
  <div className="relative z-10 h-[260px] w-[260px] shrink-0">
    <div className="absolute inset-0 overflow-hidden rounded-full border-[10px] border-amber-300 bg-slate-800 shadow-[0_0_40px_rgba(251,191,36,.35)]">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-7xl font-black text-white">
          {initials(name)}
        </div>
      )}
    </div>
    {hatKey && (
      <div
        className="pointer-events-none absolute left-1/2 z-20"
        style={{ bottom: '62%', width: '150%', transform: 'translateX(-50%)', aspectRatio: '80 / 56' }}
      >
        <BubbleHat kind={hatKey} />
      </div>
    )}
  </div>
);

/** Колизей: компьютер крутит жребий, затем награждение шляпы. */
const LiderTvDuel = ({ duel }: { duel: TvDuel }) => {
  if (duel.phase === 'award' && duel.winnerSide) {
    const winner = duel.winnerSide === 'left' ? duel.left : duel.right;
    const loser = duel.winnerSide === 'left' ? duel.right : duel.left;
    const hatStays = duel.winnerSide === 'right';
    const left = timeLeft(duel.boostUntil);
    const bonus = duel.hatBonus ?? 5000;
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_center,#5a3414_0%,#120a06_68%)] px-10 text-white">
        <p className="text-3xl font-semibold uppercase tracking-[0.45em] text-amber-300">Награждение</p>
        <div className="mt-44">
          <Portrait name={winner.name} avatarUrl={winner.avatarUrl} hatKey={duel.hatKey} />
        </div>
        <h2 className="mt-8 text-center text-6xl font-black">{winner.name}</h2>
        {hatStays ? (
          <>
            <p className="mt-3 text-center text-4xl text-amber-100">
              оставляет «{duel.hatTitle || 'шляпу'}» и получает {bonus.toLocaleString('ru-RU')} вариков
            </p>
            <p className="mt-4 text-3xl text-white/70">
              {loser.name} платит {duel.stake.toLocaleString('ru-RU')}
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 text-center text-4xl text-amber-100">
              забирает «{duel.hatTitle || 'шляпу'}»
              {left ? ` · ещё ${left}` : ''}
            </p>
            <p className="mt-4 text-3xl text-white/70">варики не трогали</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[radial-gradient(circle_at_center,#3f2a12_0%,#120a06_70%)] px-8 py-8 text-white">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-semibold uppercase tracking-[0.35em] text-amber-300">Колизей</p>
          <h2 className="text-6xl font-black">Жребий</h2>
        </div>
        <p className="max-w-xl text-right text-3xl text-amber-100">Компьютер решает, кому шляпа</p>
      </div>
      <div className="flex flex-1 items-center justify-between gap-6">
        <div className="flex w-[320px] flex-col items-center">
          <Portrait
            name={duel.left.name}
            avatarUrl={duel.left.avatarUrl}
            hatKey={duel.hatOn === 'left' ? duel.hatKey : null}
          />
          <p className="mt-4 max-w-full text-center text-3xl font-black leading-tight break-words">{duel.left.name}</p>
          <p className="mt-1 text-2xl text-white/60">без шляпы</p>
        </div>
        <div className="flex flex-col items-center">
          <div className="h-40 w-40 animate-spin rounded-full border-[10px] border-amber-200 bg-gradient-to-br from-amber-300 to-amber-800 shadow-[0_0_40px_rgba(251,191,36,.45)]" />
          <p className="mt-5 text-4xl font-black uppercase tracking-[0.3em] text-amber-200">Жребий</p>
          {duel.hatTitle && <p className="mt-3 text-2xl text-amber-100">на кону · {duel.hatTitle}</p>}
          {timeLeft(duel.boostUntil) && (
            <p className="mt-2 text-2xl text-amber-200">ещё {timeLeft(duel.boostUntil)}</p>
          )}
        </div>
        <div className="flex w-[320px] flex-col items-center">
          <Portrait
            name={duel.right.name}
            avatarUrl={duel.right.avatarUrl}
            hatKey={duel.hatOn === 'right' ? duel.hatKey : null}
          />
          <p className="mt-4 max-w-full text-center text-3xl font-black leading-tight break-words">{duel.right.name}</p>
          <p className="mt-1 text-2xl text-white/60">со шляпой</p>
        </div>
      </div>
    </div>
  );
};

export default LiderTvDuel;
