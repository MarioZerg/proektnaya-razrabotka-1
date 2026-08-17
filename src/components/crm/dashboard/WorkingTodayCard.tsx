import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { fetchWorkingToday, type WorkingShiftToday } from '@/lib/shiftsApi';

/** Кто по графику должен быть в цехах сегодня. Рядом с каждой сменой — сколько человек
 * уже открыли смену: сразу видно, если бригада вышла, но не отметилась на терминале. */
const WorkingTodayCard = () => {
  const [shifts, setShifts] = useState<WorkingShiftToday[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchWorkingToday()
      .then(setShifts)
      .finally(() => setLoading(false));
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
        <div className="flex items-center gap-2">
          <Icon name="Users" size={18} className="text-muted-foreground" />
          <p className="font-medium">Сегодня работают</p>
          <span className="text-sm text-muted-foreground">· {today}</span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : shifts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Сегодня выходной — по графику ни одна смена не работает.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {shifts.map((s) => (
              <div
                key={`${s.workshopId}-${s.shiftNumber}`}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
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
