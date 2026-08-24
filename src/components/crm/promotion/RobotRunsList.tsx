import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { RobotRun } from '@/lib/priceRobotApi';

/**
 * Журнал робота: что он решил и почему.
 *
 * Без журнала автоматика — чёрный ящик: цены поехали, а причина неизвестна.
 * Здесь каждый шаг подписан словами, с продажами до и после.
 */
interface Props {
  runs: RobotRun[];
}

const LOOK: Record<
  string,
  { icon: string; label: string; className: string }
> = {
  raise: {
    icon: 'TrendingUp',
    label: 'Подняли цены',
    className: 'text-emerald-700',
  },
  rollback: {
    icon: 'Undo2',
    label: 'Откатили назад',
    className: 'text-amber-700',
  },
  stop: { icon: 'CircleCheck', label: 'Цель достигнута', className: 'text-emerald-700' },
  hold: { icon: 'Pause', label: 'Выждали', className: 'text-muted-foreground' },
  skip: { icon: 'Clock', label: 'Рано', className: 'text-muted-foreground' },
  test: { icon: 'FlaskConical', label: 'Проверка', className: 'text-muted-foreground' },
  // Ручной шаг владельца — выделяем, чтобы не путать с решением робота.
  manual: { icon: 'Hand', label: 'Сдвинули вручную', className: 'text-blue-700' },
};

/**
 * Время шага по Москве.
 *
 * Сервер пишет метки по UTC и отдаёт их без часового пояса. Браузер такую
 * строку считает местным временем, и шаг, сделанный в 23:17 по Москве,
 * показывался бы как 20:17 — на три часа раньше, чем было на самом деле.
 */
const when = (iso: string) => {
  const utc = iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`;
  return new Date(utc).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
};

const RobotRunsList = ({ runs }: Props) => {
  if (!runs.length) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Робот ещё не делал шагов. Первый появится здесь после запуска
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map((r, idx) => {
        const look = LOOK[r.decision] || LOOK.hold;
        return (
          <Card key={`${r.ranAt}-${idx}`}>
            <CardContent className="flex items-start gap-3 p-3">
              <Icon
                name={look.icon}
                fallback="Circle"
                size={18}
                className={`mt-0.5 shrink-0 ${look.className}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-sm font-medium ${look.className}`}>
                    {look.label}
                  </span>
                  {r.stepPercent !== null && r.stepPercent !== 0 && (
                    <span className="text-sm font-bold tabular-nums">
                      {r.stepPercent > 0 ? '+' : ''}
                      {r.stepPercent}%
                    </span>
                  )}
                  {r.dryRun && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900">
                      наблюдение
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {when(r.ranAt)}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {r.reason}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                  {r.driftPercent !== null && (
                    <span>
                      Цены от старта{' '}
                      <span className="font-medium text-foreground">
                        {r.driftPercent > 0 ? '+' : ''}
                        {r.driftPercent}%
                      </span>
                    </span>
                  )}
                  {r.unitsChange !== null && (
                    <span>
                      Спрос {r.unitsBefore} → {r.unitsAfter} шт{' '}
                      <span
                        className={`font-medium ${
                          r.unitsChange < 0 ? 'text-rose-700' : 'text-emerald-700'
                        }`}
                      >
                        ({r.unitsChange > 0 ? '+' : ''}
                        {r.unitsChange}%)
                      </span>
                    </span>
                  )}
                  {r.itemsPushed > 0 && (
                    <span>
                      Карточек изменено{' '}
                      <span className="font-medium text-foreground">
                        {r.itemsPushed}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default RobotRunsList;
