import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { SchedulerJob } from '@/lib/schedulerStatusApi';

/** Когда задание отработало — понятным языком, без дат и секунд. */
const agoText = (minutes: number | null) => {
  if (minutes === null) return 'ни разу';
  if (minutes < 2) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'вчера' : `${days} дн назад`;
};

/** Как часто задание должно запускаться. */
const everyText = (min: number) => {
  if (min < 60) return `каждые ${min} мин`;
  if (min < 1440) return min === 60 ? 'каждый час' : `каждые ${min / 60} ч`;
  return 'раз в сутки';
};

const STATE_STYLE: Record<
  SchedulerJob['state'],
  { border: string; icon: string; color: string }
> = {
  ok: { border: 'border-emerald-300 bg-emerald-50', icon: 'CircleCheck', color: 'text-emerald-600' },
  late: { border: 'border-amber-300 bg-amber-50', icon: 'TriangleAlert', color: 'text-amber-600' },
  never: { border: 'border-rose-300 bg-rose-50', icon: 'CircleX', color: 'text-rose-600' },
  // Ночное задание может законно молчать — красить его тревожным цветом нельзя,
  // иначе к предупреждениям на странице привыкают и перестают их читать.
  unknown: { border: 'border-border', icon: 'CircleDashed', color: 'text-muted-foreground' },
};

/** Одно фоновое задание: что делает, когда отработало и что нашло. */
const SchedulerJobCard = ({ job }: { job: SchedulerJob }) => {
  const st = STATE_STYLE[job.state];

  return (
    <Card className={`shadow-none ${st.border}`}>
      <CardContent className="space-y-2 py-4">
        <div className="flex items-start gap-2">
          <Icon name={st.icon} size={20} className={`mt-0.5 shrink-0 ${st.color}`} />
          <div className="min-w-0 flex-1">
            <p className="font-bold leading-tight">{job.title}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{job.purpose}</p>
          </div>
        </div>

        <div className="space-y-1 pl-7 text-sm">
          <p>
            <span className="text-muted-foreground">Отработало: </span>
            <span className="font-medium">{agoText(job.minutesAgo)}</span>
            {/* Задание, которое молчит дольше положенного, — это не мелочь:
                заказы в это время не приходят, а отмены копятся. */}
            {job.state === 'late' && (
              <span className="font-medium text-amber-700"> — слишком давно</span>
            )}
            {job.state === 'never' && (
              <span className="font-medium text-rose-700"> — задание не подключено</span>
            )}
          </p>
          <p className="text-muted-foreground">
            Должно запускаться {everyText(job.everyMin)} · за сутки: {job.runsPerDay}
          </p>
          {job.lastResult && <p className="text-muted-foreground">{job.lastResult}</p>}
          {/* У ночного задания молчание — норма, и это нужно сказать прямо:
              иначе админ идёт чинить исправное задание. */}
          {job.state === 'unknown' && (
            <p className="text-muted-foreground">
              Запускается ночью и отмечается, только когда есть работа — молчание не
              означает поломку
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default SchedulerJobCard;
