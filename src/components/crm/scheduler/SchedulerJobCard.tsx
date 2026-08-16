import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
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
  const { toast } = useToast();
  const st = STATE_STYLE[job.state];
  const [showUrl, setShowUrl] = useState(false);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${what} скопирован` });
    } catch {
      // Копирование в буфер работает не везде (старый браузер, доступ по http) —
      // тогда просто оставляем адрес на экране, его можно выделить руками.
      toast({
        title: 'Не удалось скопировать',
        description: 'Выделите адрес и скопируйте вручную',
        variant: 'destructive',
      });
    }
  };

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

        {/* Готовый адрес для планировщика. Прячем под кнопку: внутри ключ запуска,
            и держать его постоянно на экране незачем — подсмотрят через плечо. */}
        {job.url && (
          <div className="space-y-2 pl-7">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowUrl((v) => !v)}>
                <Icon name={showUrl ? 'EyeOff' : 'Link'} size={14} className="mr-1" />
                {showUrl ? 'Скрыть адрес' : 'Показать адрес'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => copy(job.url!, 'Адрес')}>
                <Icon name="Copy" size={14} className="mr-1" />
                Копировать
              </Button>
            </div>

            {showUrl && (
              <div className="space-y-2">
                {/* Метод важен: задание со штрафами работает только через POST,
                    обычной ссылкой его не запустить. */}
                {job.method === 'POST' && (
                  <p className="text-sm font-medium text-amber-700">
                    Задание запускается методом POST — в планировщике выберите POST и
                    вставьте тело запроса
                  </p>
                )}
                <p className="break-all rounded border bg-background px-2 py-1 font-mono-tech text-xs">
                  {job.url}
                </p>
                {job.body && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Тело запроса:</p>
                    <p className="break-all rounded border bg-background px-2 py-1 font-mono-tech text-xs">
                      {job.body}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copy(job.body!, 'Тело запроса')}
                    >
                      <Icon name="Copy" size={14} className="mr-1" />
                      Копировать тело
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SchedulerJobCard;