import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchOwnAvatar } from '@/lib/usersApi';
import { BubbleHat } from '@/components/lider/bubbleHats';
import {
  challengeDuel,
  fetchDuelDesk,
  type DuelDesk,
  type DuelTarget,
} from '@/lib/varikiApi';

const initials = (name: string) =>
  name.split(' ').slice(0, 2).map((p) => p[0]).join('').toUpperCase();

const daysLeft = (iso: string | null) => {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return days > 0 ? `${days} д ${hours} ч` : `${Math.max(1, hours)} ч`;
};

const whenPlayed = (iso: string | null) => {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const ResultFace = ({
  person,
}: {
  person: { name: string; avatarUrl?: string | null; won: boolean };
}) => (
  <div className="flex min-w-0 flex-1 items-center gap-2">
    <Avatar className="h-8 w-8 shrink-0 border border-amber-700">
      {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
      <AvatarFallback className="bg-[#3a2412] text-[10px] text-amber-100">{initials(person.name)}</AvatarFallback>
    </Avatar>
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-white">{person.name}</p>
      <p className={`text-[11px] ${person.won ? 'text-amber-300' : 'text-stone-400'}`}>
        {person.won ? 'выиграла' : 'проиграла'}
      </p>
    </div>
  </div>
);

interface DuelTabProps {
  userId: number;
}

/** Вкладка «Дуэль»: арена и кого можно вызвать. Правила живут отдельно. */
const DuelTab = ({ userId }: DuelTabProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [myAvatar, setMyAvatar] = useState<string | null>(null);
  const [desk, setDesk] = useState<DuelDesk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [ask, setAsk] = useState<DuelTarget | null>(null);

  const load = () => {
    fetchDuelDesk(userId)
      .then((d) => {
        setDesk(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось открыть дуэль'));
  };

  useEffect(() => {
    fetchOwnAvatar().then(setMyAvatar).catch(() => setMyAvatar(null));
  }, [userId]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 4000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const send = async () => {
    if (!ask) return;
    setBusyId(ask.id);
    try {
      await challengeDuel(userId, ask.id);
      toast({ title: 'Вызов отправлен', description: `${ask.name} увидит его на телефоне` });
      setAsk(null);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось вызвать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="overflow-hidden rounded-[28px] border border-[#6b4423] bg-[#120c07] text-[#f6e7c1] shadow-[0_18px_50px_rgba(48,24,4,.28)]">
      <div
        className="relative px-4 pb-8 pt-5 sm:px-6"
        style={{ background: 'radial-gradient(circle at 50% 18%, #5a3414 0%, #1a1008 58%, #100a06 100%)' }}
      >
        <div className="pointer-events-none absolute inset-x-3 top-0 flex h-14 items-end justify-between gap-1.5 sm:inset-x-6" aria-hidden>
          {Array.from({ length: 8 }, (_, i) => (
            <span
              key={i}
              className="h-10 flex-1 rounded-t-full border-x border-t border-amber-200/25 bg-gradient-to-b from-amber-100/15 to-transparent"
            />
          ))}
        </div>

        <div className="relative text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.42em] text-amber-300">Колизей</p>
          <h2 className="mt-1 text-4xl font-black tracking-tight text-white">Дуэль за шляпу</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-amber-50/90">
            Песок уже тёплый. Слева выходишь ты — с пустыми руками.
            Справа та, у кого шляпа сидит на голове.
            Жребий сам решит, кому она достанется, а цех увидит это на телевизоре.
          </p>
        </div>

        <div className="relative mx-auto mt-6 h-28 max-w-md">
          <div className="absolute inset-x-4 bottom-1 h-16 rounded-[50%] border-[5px] border-[#8a5a28] bg-gradient-to-b from-[#f0d59a] to-[#b88845] shadow-[inset_0_-8px_16px_rgba(90,40,0,.35)]" />
          <div className="absolute bottom-6 left-[8%] flex flex-col items-center">
            <span className="flex h-14 w-14 overflow-hidden rounded-full border-4 border-amber-200 bg-[#3a2412]">
              {myAvatar ? (
                <img src={myAvatar} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs font-bold text-amber-100">
                  {initials(user?.name || 'Вы')}
                </span>
              )}
            </span>
            <span className="mt-1 text-[10px] font-bold uppercase tracking-wide text-amber-100">вы</span>
            <span className="text-[10px] text-amber-100/80">без шляпы</span>
          </div>
          <div className="absolute bottom-6 right-[8%] flex flex-col items-center">
            <span className="relative flex h-14 w-14 items-center justify-center rounded-full border-4 border-amber-200 bg-[#3a2412] text-[10px] font-bold uppercase tracking-wide text-amber-100">
              она
              <span className="pointer-events-none absolute -top-4 left-1/2 w-12 -translate-x-1/2">
                <BubbleHat kind="crown" />
              </span>
            </span>
            <span className="mt-1 text-[10px] text-amber-100/80">со шляпой</span>
          </div>
        </div>
      </div>

      <div className="space-y-3 bg-[#1b120c] px-3 py-4 sm:px-4">
        {error && (
          <p className="rounded-xl border border-red-400/40 bg-red-950/50 px-3 py-2 text-sm text-red-100">{error}</p>
        )}
        {!desk && !error && <p className="text-sm text-amber-100/70">Открываем ворота арены…</p>}

        {desk?.blockReason && (
          <p className="rounded-xl border border-amber-400/40 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
            {desk.blockReason}
          </p>
        )}

        {desk?.outgoing && (
          <p className="rounded-xl border border-amber-200/20 bg-black/30 px-3 py-2 text-sm">
            Ждём ответ от {desk.outgoing.them.name}. Вызов живёт 2 минуты.
          </p>
        )}

        {desk?.live && desk.live.phase !== 'outgoing' && desk.live.phase !== 'incoming' && (
          <p className="rounded-xl border border-amber-200/20 bg-black/30 px-3 py-2 text-sm">
            Жребий уже брошен
            {desk.live.phase === 'draw'
              ? ' — на телевизоре ещё крутится.'
              : desk.live.youWon
                ? ' — награждение: вы взяли своё.'
                : ' — награждение прошло.'}
          </p>
        )}

        {desk && (
          <>
            <div className="flex items-end justify-between gap-3 pt-1">
              <h3 className="text-lg font-black text-white">На арене</h3>
              <span className="text-xs text-amber-100/60">шляпы, которые ещё можно отнять</span>
            </div>

            {desk.canChallenge && desk.targets.length === 0 && (
              <p className="text-sm text-amber-100/70">Сейчас трибуны пусты: нет швей с действующей шляпой.</p>
            )}

            <div className="grid gap-2">
              {desk.targets.map((person) => {
                const locked = Boolean(person.lockedUntil && daysLeft(person.lockedUntil));
                return (
                  <div
                    key={person.id}
                    className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${
                      locked ? 'border-stone-700 bg-black/25 opacity-80' : 'border-amber-800/80 bg-[#24160d]'
                    }`}
                  >
                    <div className="relative h-16 w-16 shrink-0">
                      <Avatar className="h-16 w-16 border-4 border-amber-300">
                        {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt="" /> : null}
                        <AvatarFallback className="bg-[#3a2412] text-amber-100">{initials(person.name)}</AvatarFallback>
                      </Avatar>
                      <div className="pointer-events-none absolute -top-3 left-1/2 w-14 -translate-x-1/2">
                        <BubbleHat kind={person.hat} />
                      </div>
                      {locked && (
                        <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-amber-100 ring-2 ring-amber-300">
                          <Icon name="Lock" size={13} />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-white">{person.name}</p>
                      <p className="truncate text-xs text-amber-100/70">
                        {locked
                          ? `Замок · снова через ${daysLeft(person.lockedUntil || null)}`
                          : person.hatTitle}
                      </p>
                      {!locked && daysLeft(person.boostUntil) && (
                        <p className="text-sm font-bold text-amber-300">
                          Шляпа ещё {daysLeft(person.boostUntil)}
                        </p>
                      )}
                    </div>
                    {locked ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-amber-100/70">
                        <Icon name="Lock" size={14} />
                        Замок
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        className="bg-amber-400 text-stone-950 hover:bg-amber-300"
                        disabled={!desk.canChallenge || busyId === person.id}
                        onClick={() => setAsk(person)}
                      >
                        Вызвать
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>

            {(desk.history?.length ?? 0) > 0 ? (
              <div className="space-y-2 pt-3">
                <h3 className="text-lg font-black text-white">Кто выходил на песок</h3>
                {desk.history?.map((row) => (
                  <div key={row.id} className="rounded-2xl border border-amber-900/50 bg-black/25 px-3 py-3">
                    <div className="flex items-start gap-2">
                      <ResultFace person={row.challenger} />
                      <ResultFace person={row.opponent} />
                    </div>
                    <p className="mt-2 text-[11px] text-amber-100/50">
                      {whenPlayed(row.at)}
                      {row.hatTitle ? ` · ${row.hatTitle}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="pt-3 text-sm text-amber-100/55">На песок ещё никто не выходил.</p>
            )}
          </>
        )}
      </div>

      {ask && desk && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-3xl border border-amber-700 bg-[#1a1008] p-5 text-[#f6e7c1] shadow-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-amber-300">Вызов на арену</p>
            <p className="mt-1 text-xl font-black text-white">Вызвать {ask.name}?</p>
            <p className="mt-3 rounded-2xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-center text-base font-bold text-amber-200">
              У шляпы осталось {daysLeft(ask.boostUntil) || 'меньше часа'}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-amber-50/80">
              На кону {ask.hatTitle}. Жребий не твой — с тебя спишут {desk.stake.toLocaleString('ru-RU')} вариков,
              шляпа останется у неё, и ей достанется {(desk.hatBonus ?? 5000).toLocaleString('ru-RU')} вариков.
              Жребий твой — заберёшь только шляпу, на сколько ей ещё жить.
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-amber-700 bg-transparent text-amber-100 hover:bg-white/10 hover:text-white"
                onClick={() => setAsk(null)}
              >
                Отмена
              </Button>
              <Button
                className="flex-1 bg-amber-400 text-stone-950 hover:bg-amber-300"
                disabled={busyId === ask.id}
                onClick={send}
              >
                Бросить жребий
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DuelTab;
