import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { fetchMyAward, type OneTimeAward } from '@/lib/salaryApi';

const formatMoney = (value: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' ₽';

const formatDay = (iso: string) =>
  new Date(iso + 'T00:00:00+03:00').toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'long',
    timeZone: 'Europe/Moscow',
  });

/** Остаток до выплаты, разложенный на дни/часы/минуты/секунды. */
const splitLeft = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
};

interface AwardCardProps {
  userId?: number;
}

/**
 * ПРЕМИЯ СОТРУДНИКУ с обратным отсчётом до дня выплаты.
 *
 * Смысл карточки не в том, чтобы сообщить сумму — сумму можно было бы просто
 * начислить в нужный день молча. Смысл в том, что человек видит признание ДО
 * того, как получит деньги: перечислены его собственные цифры за месяц, и рядом
 * тикает счётчик. Премия перестаёт быть безликой строкой в балансе и становится
 * событием, которое ждут.
 *
 * Карточка живёт ровно до начисления: сервер отдаёт только НЕВЫПЛАЧЕННУЮ премию,
 * поэтому в день выплаты ответ становится пустым и блок пропадает сам. Убирать
 * его руками или выключать флагом не нужно — и повторно начислить премию тоже
 * нельзя, начисление одноразовое на стороне базы.
 *
 * Раз в минуту перезапрашиваем данные — чтобы карточка ушла в день выплаты без
 * перезагрузки страницы; сам таймер тикает каждую секунду локально.
 */
const AwardCard = ({ userId }: AwardCardProps) => {
  const [award, setAward] = useState<OneTimeAward | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => {
    if (!userId) return;
    fetchMyAward(userId)
      .then(setAward)
      .catch(() => setAward(null));
  }, [userId]);

  useEffect(() => {
    load();
    const refresh = setInterval(load, 60000);
    return () => clearInterval(refresh);
  }, [load]);

  useEffect(() => {
    if (!award) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [award]);

  if (!award) return null;

  const left = splitLeft(new Date(award.payAt).getTime() - now);
  const arrived = left.days + left.hours + left.minutes + left.seconds === 0;

  const cells = [
    { value: left.days, label: 'дн' },
    { value: left.hours, label: 'ч' },
    { value: left.minutes, label: 'мин' },
    { value: left.seconds, label: 'сек' },
  ];

  return (
    <Card className="overflow-hidden border-0 bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 text-white shadow-lg">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/80">
              <Icon name="Sparkles" size={14} />
              {award.title}
            </p>
            <p className="mt-1 text-3xl font-extrabold leading-none sm:text-4xl">
              {formatMoney(award.amount)}
            </p>
            <p className="mt-1.5 text-sm text-white/90">
              Начислится на ваш баланс {formatDay(award.payOn)}
            </p>
          </div>

          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Icon name="Trophy" size={28} className="text-white" />
          </div>
        </div>

        {/* Таймер: ожидание — часть награды. Видно, что до денег осталось
            конкретное время, а не «когда-нибудь». */}
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-white/80">
            <Icon name="Timer" size={13} />
            {arrived ? 'Премия начисляется прямо сейчас' : 'До начисления осталось'}
          </p>
          <div className="flex gap-2">
            {cells.map((c) => (
              <div
                key={c.label}
                className="min-w-[58px] flex-1 rounded-xl bg-white/15 px-2 py-2 text-center backdrop-blur-sm"
              >
                <p className="text-xl font-bold tabular-nums leading-none sm:text-2xl">
                  {String(c.value).padStart(2, '0')}
                </p>
                <p className="mt-1 text-[10px] uppercase tracking-wide text-white/70">{c.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* За что именно премия: без этого списка сумма читается как подарок, а
            она заработана — и в следующем месяце её можно заработать снова. */}
        {award.highlights.length > 0 && (
          <div className="rounded-xl bg-white/15 p-3 backdrop-blur-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/80">
              За что эта премия
            </p>
            <ul className="space-y-1.5">
              {award.highlights.map((h) => (
                <li key={h} className="flex items-start gap-2 text-sm leading-snug">
                  <Icon name="Check" size={15} className="mt-0.5 shrink-0 text-white" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-white/80">
          Спасибо за работу — цех держится на вашем темпе. Так держать!
        </p>
      </CardContent>
    </Card>
  );
};

export default AwardCard;
