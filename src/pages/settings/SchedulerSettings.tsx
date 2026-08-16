import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { fetchSchedulerStatus, type SchedulerJob } from '@/lib/schedulerStatusApi';

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
const everyText = (min: number) => (min < 60 ? `каждые ${min} мин` : 'каждый час');

const STATE_STYLE: Record<SchedulerJob['state'], { border: string; icon: string; color: string }> = {
  ok: { border: 'border-emerald-300 bg-emerald-50', icon: 'CircleCheck', color: 'text-emerald-600' },
  late: { border: 'border-amber-300 bg-amber-50', icon: 'TriangleAlert', color: 'text-amber-600' },
  never: { border: 'border-rose-300 bg-rose-50', icon: 'CircleX', color: 'text-rose-600' },
};

/**
 * Планировщик — состояние фоновых заданий.
 *
 * Задания запускает внешний сервис по расписанию: он дёргает ссылку, а система
 * выполняет работу. Проблема в том, что молчащий планировщик выглядит точно так же,
 * как работающий — заказы просто перестают приходить, а отмены копятся незамеченными.
 * Именно так однажды накопились двести необработанных отмен OZON.
 *
 * Поэтому страница показывает не «настроено / не настроено», а факт: когда каждое
 * задание отработало в последний раз и что нашло.
 */
const SchedulerSettings = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [jobs, setJobs] = useState<SchedulerJob[]>([]);
  const [problems, setProblems] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetchSchedulerStatus()
      .then((d) => {
        setJobs(d.items);
        setProblems(d.problems);
      })
      .catch((e) =>
        toast({
          title: 'Не удалось загрузить',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        }),
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // Обновляем сами: страницу держат открытой, а задания продолжают работать.
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isAdmin) {
    return (
      <CrmLayout>
        <p className="text-sm text-muted-foreground">Раздел доступен только администратору.</p>
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Планировщик</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Фоновые задания забирают заказы с маркетплейсов и ловят отказы покупателей.
              Работают сами, без открытой системы
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <Icon
              name={loading ? 'Loader2' : 'RefreshCw'}
              size={14}
              className={`mr-1 ${loading ? 'animate-spin' : ''}`}
            />
            Обновить
          </Button>
        </div>

        {/* Общее состояние: одной строкой, чтобы не вчитываться в карточки. */}
        {!loading && (
          <div
            className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
              problems === 0 ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'
            }`}
          >
            <Icon
              name={problems === 0 ? 'ShieldCheck' : 'TriangleAlert'}
              size={24}
              className={`shrink-0 ${problems === 0 ? 'text-emerald-600' : 'text-amber-600'}`}
            />
            <p
              className={`font-bold ${problems === 0 ? 'text-emerald-900' : 'text-amber-900'}`}
            >
              {problems === 0
                ? 'Все задания работают'
                : `Не работает заданий: ${problems} — заказы и отмены могут не приходить`}
            </p>
          </div>
        )}

        {loading && jobs.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {jobs.map((j) => {
              const st = STATE_STYLE[j.state];
              return (
                <Card key={j.key} className={`shadow-none ${st.border}`}>
                  <CardContent className="space-y-2 py-4">
                    <div className="flex items-start gap-2">
                      <Icon name={st.icon} size={20} className={`mt-0.5 shrink-0 ${st.color}`} />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold leading-tight">{j.title}</p>
                        <p className="mt-0.5 text-sm text-muted-foreground">{j.purpose}</p>
                      </div>
                    </div>

                    <div className="space-y-1 pl-7 text-sm">
                      <p>
                        <span className="text-muted-foreground">Отработало: </span>
                        <span className="font-medium">{agoText(j.minutesAgo)}</span>
                        {/* Задание, которое молчит дольше положенного, — это не мелочь:
                            заказы в это время не приходят, а отмены копятся. */}
                        {j.state === 'late' && (
                          <span className="font-medium text-amber-700"> — слишком давно</span>
                        )}
                        {j.state === 'never' && (
                          <span className="font-medium text-rose-700"> — задание не подключено</span>
                        )}
                      </p>
                      <p className="text-muted-foreground">
                        Должно запускаться {everyText(j.everyMin)} · за сутки: {j.runsPerDay}
                      </p>
                      {j.lastResult && (
                        <p className="text-muted-foreground">{j.lastResult}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Куда идти, если задание перестало работать. Ссылки на задания живут во
            внешнем сервисе — без этой подсказки админ не знает, где их искать. */}
        <Card className="shadow-none">
          <CardContent className="py-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Если задание не работает</p>
            <p className="mt-1">
              Расписание живёт во внешнем сервисе cron-job.org — там задания включаются и
              выключаются. Проверьте, что задание включено и последний запуск прошёл без ошибки
            </p>
          </CardContent>
        </Card>
      </div>
    </CrmLayout>
  );
};

export default SchedulerSettings;
