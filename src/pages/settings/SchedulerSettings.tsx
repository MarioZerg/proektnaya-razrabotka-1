import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import SchedulerJobCard from '@/components/crm/scheduler/SchedulerJobCard';
import MarketplaceReconcile from '@/components/crm/scheduler/MarketplaceReconcile';
import {
  fetchSchedulerStatus,
  type SchedulerGroup,
  type SchedulerJob,
} from '@/lib/schedulerStatusApi';

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
 *
 * Задания сгруппированы по смыслу работы, а не по маркетплейсам: админ открывает
 * страницу с вопросом «что сломалось», и ему важно сразу видеть ЧТО именно —
 * приём заказов, ловля отмен или служебная работа склада.
 */
const SchedulerSettings = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [jobs, setJobs] = useState<SchedulerJob[]>([]);
  const [groups, setGroups] = useState<SchedulerGroup[]>([]);
  const [problems, setProblems] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    // Передаём себя: ссылки с ключом запуска сервер отдаёт только администратору.
    fetchSchedulerStatus(user?.id)
      .then((d) => {
        setJobs(d.items);
        setGroups(d.groups);
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
  }, [user?.id]);

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
              Фоновые задания забирают заказы с маркетплейсов, ловят отказы покупателей и
              ведут склад. Работают сами, без открытой системы
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
            <p className={`font-bold ${problems === 0 ? 'text-emerald-900' : 'text-amber-900'}`}>
              {problems === 0
                ? `Все задания работают: ${jobs.length}`
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
          groups.map((g) => {
            const groupJobs = jobs.filter((j) => j.group === g.key);
            if (groupJobs.length === 0) return null;
            // Сломанные задания внутри раздела — сразу видно, сколько именно.
            const broken = groupJobs.filter(
              (j) => j.state === 'late' || j.state === 'never',
            ).length;

            return (
              <div key={g.key} className="space-y-2">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <h2 className="font-bold">{g.title}</h2>
                  <p className="text-sm text-muted-foreground">{g.hint}</p>
                  {broken > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                      не работает: {broken}
                    </span>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {groupJobs.map((j) => (
                    <SchedulerJobCard key={j.key} job={j} />
                  ))}
                </div>
              </div>
            );
          })
        )}

        {/* Сверка с площадками. Планировщик выше показывает, что задания ЗАПУСКАЮТСЯ,
            но запускаться они могут и впустую: 117 заказов OZON однажды висели на
            площадке, а до цеха не доехали. Сверка ловит именно это. */}
        <MarketplaceReconcile />

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
