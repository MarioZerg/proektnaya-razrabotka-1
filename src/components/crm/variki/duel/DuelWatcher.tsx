import { useEffect, useRef, useState } from 'react';
import { playDuelStart, playDuelWin } from '@/lib/gameSounds';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import {
  answerDuel,
  fetchDuelDesk,
  type DuelView,
} from '@/lib/varikiApi';

const timeLeft = (iso: string | null | undefined) => {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return days > 0 ? `${days} д ${hours} ч` : `${Math.max(1, hours)} ч`;
};

/** Короткий сигнал «вас вызывают»: два тона, без файла. */
const chime = () => {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const now = ctx.currentTime;
  [523, 784].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.3);
  });
  window.setTimeout(() => ctx.close().catch(() => undefined), 900);
};

interface DuelWatcherProps {
  userId: number;
}

/**
 * Вызов на дуэль приходит на любой странице CRM: звук и окно
 * «принять / отказаться». Исход решает компьютер, жест выбирать не нужно.
 */
const DuelWatcher = ({ userId }: DuelWatcherProps) => {
  const { toast } = useToast();
  const [incoming, setIncoming] = useState<DuelView | null>(null);
  const [live, setLive] = useState<DuelView | null>(null);
  const [busy, setBusy] = useState(false);
  const heard = useRef<number | null>(null);
  const liveRef = useRef<DuelView | null>(null);
  const played = useRef(new Set<string>());

  useEffect(() => {
    let stop = false;
    const tick = () => {
      fetchDuelDesk(userId)
        .then((desk) => {
          if (stop) return;
          const nextIn = desk.incoming;
          const nextLive = desk.live && desk.live.phase !== 'incoming' && desk.live.phase !== 'outgoing'
            ? desk.live
            : null;
          if (nextIn && heard.current !== nextIn.id) {
            heard.current = nextIn.id;
            chime();
          }
          if (!nextIn) heard.current = null;
          if (nextLive?.phase === 'draw' && !played.current.has(`${nextLive.id}:draw`)) {
            played.current.add(`${nextLive.id}:draw`);
            playDuelStart();
          }
          if (
            nextLive &&
            (nextLive.phase === 'award' || nextLive.phase === 'done') &&
            !played.current.has(`${nextLive.id}:win`)
          ) {
            played.current.add(`${nextLive.id}:win`);
            playDuelWin();
          }
          setIncoming(nextIn);
          setLive(nextLive);
          liveRef.current = nextLive;
        })
        .catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, liveRef.current ? 1500 : 3000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [userId, live?.id, live?.phase]);

  const answer = async (accept: boolean) => {
    if (!incoming) return;
    setBusy(true);
    try {
      await answerDuel(userId, incoming.id, accept);
      setIncoming(null);
      toast({ title: accept ? 'Дуэль принята' : 'Вызов отклонён' });
    } catch (e) {
      toast({
        title: 'Не удалось ответить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const bonus = incoming?.hatBonus ?? live?.hatBonus ?? 5000;
  const award = (() => {
    if (!live || live.youWon == null) return '';
    const left = timeLeft(live.boostUntil);
    if (live.youWon && live.youAre === 'opponent') {
      return `Шляпа остаётся у вас. +${bonus.toLocaleString('ru-RU')} вариков.`;
    }
    if (live.youWon) {
      return `Шляпа ваша${left ? `, ещё ${left}` : ''}. Варики не трогали.`;
    }
    if (live.youAre === 'challenger') {
      return `Шляпа остаётся у ${live.them.name}. С вас списано ${live.stake.toLocaleString('ru-RU')} вариков.`;
    }
    return `Шляпу забирает ${live.them.name}. Ваши варики при вас.`;
  })();

  return (
    <>
      {incoming && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Дуэль</p>
            <p className="mt-1 text-xl font-bold">Вас вызывают на дуэль</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {incoming.them.name} хочет забрать вашу шляпу
              {incoming.hatTitle ? ` «${incoming.hatTitle}»` : ''}.
              {timeLeft(incoming.boostUntil) ? ` Шляпа ещё ${timeLeft(incoming.boostUntil)}.` : ''}
              Если выиграете — шляпа останется, и вам начислят {(incoming.hatBonus ?? 5000).toLocaleString('ru-RU')} вариков,
              а с неё спишут {incoming.stake.toLocaleString('ru-RU')}.
              Если проиграете — шляпа уйдёт ей, ваши варики не тронут.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" className="flex-1" disabled={busy} onClick={() => answer(false)}>
                Отказаться
              </Button>
              <Button className="flex-1" disabled={busy} onClick={() => answer(true)}>
                Принять
              </Button>
            </div>
          </div>
        </div>
      )}

      {live && (live.phase === 'draw' || live.phase === 'award' || live.phase === 'done') && (
        <div className="fixed inset-x-0 bottom-0 z-[70] border-t border-border bg-card/95 p-3 shadow-2xl backdrop-blur">
          <div className="mx-auto flex max-w-lg flex-col gap-1">
            <p className="text-sm font-semibold">
              Жребий · {live.you.name} и {live.them.name}
            </p>
            <p className="text-sm text-muted-foreground">
              {live.phase === 'draw'
                ? 'На телевизоре крутится жребий. Никто из вас его не выбирает.'
                : award}
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default DuelWatcher;
