import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { fetchWorkingToday, type WorkingShiftToday } from '@/lib/shiftsApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

/** Кто по графику должен быть в цехах сегодня. Рядом с каждой сменой — сколько человек
 * уже открыли смену: сразу видно, если бригада вышла, но не отметилась на терминале. */
const WorkingTodayCard = () => {
  const [shifts, setShifts] = useState<WorkingShiftToday[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchWorkingToday()
      .then((list) => {
        setListError(null);
        setShifts(list);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить смены');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // «Сегодня» — по Москве: в цехе на Урале или в Сибири дата не должна убегать вперёд
  // относительно рабочего дня предприятия.
  const today = new Date().toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    timeZone: 'Europe/Moscow',
  });

  return (
    <Card className="border-border shadow-none">
      <CardContent className="space-y-3 pt-6">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Icon name="Users" size={18} className="shrink-0 text-muted-foreground" />
          <p className="font-medium">Сегодня работают</p>
          <span className="basis-full text-sm capitalize text-muted-foreground sm:basis-auto">
            {today}
          </span>
        </div>

        {listError ? (
          <WarehouseFetchError
            title="Не удалось загрузить смены"
            description={listError}
            onRetry={load}
          />
        ) : loading && shifts.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : shifts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Сегодня выходной — по графику ни одна смена не работает.
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {shifts.map((s) => (
              <div
                key={`${s.workshopId}-${s.shiftNumber}`}
                className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-border px-3 py-2 sm:justify-start"
              >
                <div>
                  <p className="text-sm font-medium">{s.shiftName}</p>
                  <p className="text-xs text-muted-foreground">{s.workshopName}</p>
                </div>
                {s.openedCount > 0 ? (
                  <Badge variant="secondary">на смене: {s.openedCount}</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    никто не открыл
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default WorkingTodayCard;
