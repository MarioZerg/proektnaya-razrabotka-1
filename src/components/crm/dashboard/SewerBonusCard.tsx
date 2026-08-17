import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { fetchSewerBonus, type SewerBonusInfo } from '@/lib/salaryApi';

const formatMoney = (value: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' ₽';

const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', timeZone: 'Europe/Moscow' });

interface SewerBonusCardProps {
  /** Показывать только свою строку: швея не должна видеть выработку коллег. */
  onlyUserId?: number;
}

/**
 * Бонусная программа швей на главной.
 *
 * Показывает, сколько метров человек уже сдал на стикеровку и сколько осталось до
 * премии. Шкала — не украшение: цель в 5000 метров на слух не воспринимается, а
 * полоска сразу отвечает на вопрос «я близко или нет».
 *
 * До старта программы (сентябрь) карточка работает как объявление: люди должны узнать
 * об условиях заранее, иначе первый месяц пройдёт впустую.
 */
const SewerBonusCard = ({ onlyUserId }: SewerBonusCardProps) => {
  const [info, setInfo] = useState<SewerBonusInfo | null>(null);

  useEffect(() => {
    fetchSewerBonus().then(setInfo).catch(() => setInfo(null));
  }, []);

  if (!info) return null;

  const rows = onlyUserId
    ? info.sewers.filter((s) => s.userId === onlyUserId)
    : info.sewers;

  // Швея не из программы (или список пуст) — карточку не показываем вовсе.
  if (onlyUserId && rows.length === 0) return null;

  const upcoming = info.state === 'upcoming';

  return (
    <Card className="border-violet-300 bg-violet-50 shadow-none">
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 font-bold text-violet-900">
              <Icon name="Trophy" size={16} className="text-violet-600" />
              Премия за выработку
            </p>
            <p className="mt-0.5 text-sm text-violet-900">
              {formatDay(info.periodFrom)} — {formatDay(info.periodTo)}: сдайте{' '}
              <span className="font-bold">{info.target} пог.м.</span> на стикеровку и
              получите <span className="font-bold">{formatMoney(info.amount)}</span> на баланс
            </p>
          </div>
        </div>

        {upcoming ? (
          /* Программа ещё не стартовала: показываем условия, а не пустые шкалы —
             нулевой прогресс в августе только сбивал бы с толку. */
          <div className="flex items-start gap-2 rounded-md border border-violet-300 bg-white px-3 py-2">
            <Icon name="Info" size={16} className="mt-0.5 shrink-0 text-violet-600" />
            <p className="text-sm text-violet-900">
              Программа стартует {formatDay(info.periodFrom)}. Метры считаются с того дня,
              когда вещь ушла на стикеровку — сейчас идёт подготовка, счётчик начнёт
              заполняться с первого дня месяца
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((s) => {
              const percent = Math.min(100, Math.round((s.meters / info.target) * 100));
              const left = Math.max(0, info.target - s.meters);
              const done = s.meters >= info.target;
              return (
                <div key={s.userId} className="rounded-md bg-white px-3 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="text-sm font-medium">
                      {onlyUserId ? 'Ваша выработка' : s.userName}
                    </span>
                    <span className="text-sm">
                      <span className="font-bold">{s.meters}</span>
                      <span className="text-muted-foreground"> / {info.target} пог.м.</span>
                    </span>
                  </div>

                  {/* Шкала заполнения: видно с одного взгляда, далеко ли до премии. */}
                  <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-violet-100">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        done ? 'bg-emerald-500' : 'bg-violet-500'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  <p className="mt-1 text-xs text-muted-foreground">
                    {done ? (
                      <span className="font-semibold text-emerald-700">
                        Цель достигнута — премия {formatMoney(info.amount)} будет начислена
                      </span>
                    ) : (
                      <>
                        Осталось <span className="font-semibold">{left.toFixed(1)} пог.м.</span> · {percent}%
                      </>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SewerBonusCard;
