import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { formatMoney } from '@/components/crm/dashboard/dashboardShared';
import type { EmployeeShiftStatus } from '@/lib/shiftSessionsApi';

interface MyShiftCardProps {
  me: EmployeeShiftStatus | null;
  loading: boolean;
}

/** «7 ч 20 мин» — сколько человек уже отработал. */
const workedFor = (openedAt: string, now: number) => {
  const mins = Math.max(0, Math.floor((now - new Date(openedAt).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
};

/** «17:20» из ISO-времени. */
const atTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** «08:00» из «08:00:00». */
const shortTime = (t?: string | null) => (t ? t.slice(0, 5) : null);

/**
 * Рабочее пространство кладовщика: его смена и заработок за неё.
 *
 * Кладовщик открывал смену на терминале и попадал на общий дашборд, где про
 * него самого не было ничего — только сводки по складу. Смена шла, а на экране
 * ничего не менялось: непонятно, засчиталась ли она вообще и появятся ли
 * деньги. Отсюда вопросы «а мне за сегодня заплатят?».
 *
 * Карточка отвечает на них до того, как они возникнут: смена идёт, сколько уже
 * отработано, сколько принесёт и главное — что деньги начислятся В МОМЕНТ
 * ЗАКРЫТИЯ смены, а не сами по себе. Последнее важнее всего: забытая открытой
 * смена не приносит ничего.
 */
const MyShiftCard = ({ me, loading }: MyShiftCardProps) => {
  // Время идёт — счётчик отработанного должен идти вместе с ним, иначе цифра
  // застынет на моменте входа и будет врать весь день.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  if (loading || !me) return null;

  const rate = me.shiftRate || 0;
  const open = me.isOpen;
  const canCloseAt = me.canCloseAt;
  const closeReady = !!canCloseAt && now >= new Date(canCloseAt).getTime();

  return (
    <Card
      className={`border-l-4 shadow-none ${
        open ? 'border-l-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/10' : 'border-l-muted'
      }`}
    >
      <CardContent className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex h-2 w-2 shrink-0 rounded-full ${
                  open ? 'animate-pulse bg-emerald-500' : 'bg-muted-foreground/40'
                }`}
              />
              <p className="text-base font-bold">
                {open ? 'Смена идёт' : 'Смена закрыта'}
              </p>
            </div>

            {open && me.openedAt ? (
              <p className="mt-1 text-sm text-muted-foreground">
                С {atTime(me.openedAt)} · отработано{' '}
                <span className="font-semibold text-foreground">
                  {workedFor(me.openedAt, now)}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                {shortTime(me.shiftFrom) && shortTime(me.shiftTo)
                  ? `Ваш график: ${shortTime(me.shiftFrom)}—${shortTime(me.shiftTo)}. Смена открывается на терминале в цехе`
                  : 'Смена открывается на терминале в цехе'}
              </p>
            )}
          </div>

          {rate > 0 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Оклад за смену</p>
              <p className="text-xl font-bold">{formatMoney(rate)} ₽</p>
            </div>
          )}
        </div>

        {/* Главное, чего человек не знал: деньги приходят НЕ за открытие смены,
            а за её закрытие. Открытая и забытая смена не принесёт ничего. */}
        {open && rate > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-background/70 p-2.5 text-xs">
            <Icon
              name={closeReady ? 'CircleCheck' : 'Clock'}
              size={14}
              className={`mt-0.5 shrink-0 ${
                closeReady ? 'text-emerald-600' : 'text-muted-foreground'
              }`}
            />
            <p className="text-muted-foreground">
              {closeReady ? (
                <>
                  Смену можно закрывать — после закрытия на терминале вам
                  начислится{' '}
                  <span className="font-semibold text-foreground">
                    {formatMoney(rate)} ₽
                  </span>
                </>
              ) : (
                <>
                  {formatMoney(rate)} ₽ начислятся, когда вы закроете смену на
                  терминале
                  {canCloseAt ? ` — с ${atTime(canCloseAt)}` : ''}
                </>
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MyShiftCard;
