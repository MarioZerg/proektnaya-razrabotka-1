import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { fetchSewerDaily, type SewerDailyInfo } from '@/lib/salaryApi';

const formatMoney = (value: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' ₽';

interface SewerDailyCardProps {
  /** Показывать только свою строку: швея не должна видеть выработку коллег. */
  onlyUserId?: number;
}

/**
 * АКЦИЯ ДНЯ для швей на главной.
 *
 * Отличается от месячной премии сроком: цель нужно взять за одну смену, поэтому шкала
 * здесь важнее — человек должен в любой момент видеть, сколько метров осталось, пока
 * день ещё не кончился. К вечеру по остатку понятно, успевает он или нет.
 *
 * Карточка исчезает сама, когда акции на сегодня нет: держать пустую плашку с нулями
 * бессмысленно, а прошедшие акции уже посчитаны и лежат в балансе.
 *
 * Прогресс обновляем раз в минуту: метраж растёт по мере сдачи вещей на стикеровку, и
 * швея видит движение шкалы, не перезагружая страницу.
 */
const SewerDailyCard = ({ onlyUserId }: SewerDailyCardProps) => {
  const [info, setInfo] = useState<SewerDailyInfo | null>(null);

  useEffect(() => {
    const load = () => {
      fetchSewerDaily()
        .then(setInfo)
        .catch(() => setInfo(null));
    };
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, []);

  if (!info) return null;

  const rows = onlyUserId ? info.sewers.filter((s) => s.userId === onlyUserId) : info.sewers;

  // Швея не в списке (или список пуст) — карточку не показываем вовсе.
  if (onlyUserId && rows.length === 0) return null;

  return (
    <Card className="border-amber-300 bg-amber-50 shadow-none">
      <CardContent className="space-y-3 pt-5">
        <div>
          <p className="flex items-center gap-1.5 font-bold text-amber-900">
            <Icon name="Zap" size={16} className="text-amber-600" />
            {info.title} — только сегодня
          </p>
          <p className="mt-0.5 text-sm text-amber-900">
            Сдайте <span className="font-bold">{info.target} пог.м.</span> на стикеровку за
            сегодня и получите <span className="font-bold">{formatMoney(info.amount)}</span> на
            баланс
          </p>
        </div>

        <div className="space-y-2">
          {rows.map((s) => {
            const percent = Math.min(100, Math.round((s.meters / info.target) * 100));
            const left = Math.max(0, info.target - s.meters);
            const done = s.meters >= info.target;
            return (
              <div key={s.userId} className="rounded-md bg-white px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-sm font-medium">
                    {onlyUserId ? 'Ваша выработка за сегодня' : s.userName}
                  </span>
                  <span className="text-sm">
                    <span className="font-bold">{s.meters}</span>
                    <span className="text-muted-foreground"> / {info.target} пог.м.</span>
                  </span>
                </div>

                {/* Шкала заполнения: сразу видно, далеко ли до цели. */}
                <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-amber-100">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      done ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                    style={{ width: `${percent}%` }}
                  />
                </div>

                <p className="mt-1 text-xs text-muted-foreground">
                  {done ? (
                    <span className="font-semibold text-emerald-700">
                      Цель взята — {formatMoney(info.amount)} придёт на баланс
                    </span>
                  ) : (
                    <>
                      Осталось <span className="font-semibold">{left.toFixed(1)} пог.м.</span> ·{' '}
                      {percent}%
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export default SewerDailyCard;
