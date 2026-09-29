import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { usePolling } from '@/hooks/usePolling';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import SchedulerJobCard from '@/components/crm/scheduler/SchedulerJobCard';
import MarketplaceReconcile from '@/components/crm/scheduler/MarketplaceReconcile';
import {
  fetchSchedulerStatus,
  type SchedulerGroup,
  type SchedulerJob,
} from '@/lib/schedulerStatusApi';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

const TAB_SHORT: Record<string, string> = {
  orders: 'Заказы',
  cancels: 'Отмены',
  service: 'Склад',
};

const RECONCILE_TAB = 'reconcile';

const brokenCount = (jobs: SchedulerJob[], groupKey: string) =>
  jobs.filter(
    (j) => j.group === groupKey && (j.state === 'late' || j.state === 'never'),
  ).length;

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
 * Вкладки — по смыслу работы: приём заказов, отмены, склад и сверка с площадками.
 * Админ открывает страницу с вопросом «что сломалось» и сразу видит нужный раздел.
 */
const SchedulerSettings = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [jobs, setJobs] = useState<SchedulerJob[]>([]);
  const [groups, setGroups] = useState<SchedulerGroup[]>([]);
  const [problems, setProblems] = useState(0);
  const [tooOften, setTooOften] = useState(0);
  const [extraPerMonth, setExtraPerMonth] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchSchedulerStatus(user?.id)
      .then((d) => {
        setListError(null);
        setJobs(d.items);
        setGroups(d.groups);
        setProblems(d.problems);
        setTooOften(d.tooOftenCount ?? 0);
        setExtraPerMonth(d.extraPerMonthTotal ?? 0);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить планировщик');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  usePolling(load, 120000, !!user?.id && isAdmin);

  const currentTab =
    tab && (groups.some((g) => g.key === tab) || tab === RECONCILE_TAB)
      ? tab
      : groups.find((g) => brokenCount(jobs, g.key) > 0)?.key || groups[0]?.key || RECONCILE_TAB;

  if (!isAdmin) {
    return (
      <CrmLayout>
        <p className="text-sm text-muted-foreground">Раздел доступен только администратору.</p>
      </CrmLayout>
    );
  }

  return (
    <CrmLayout>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold">Планировщик</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Фоновые задания забирают заказы с маркетплейсов, ловят отказы покупателей и
              ведут склад. Работают сами, без открытой системы
            </p>
          </div>
          <Button
            variant="outline"
            className="h-11 w-full sm:h-9 sm:w-auto"
            onClick={load}
            disabled={loading}
          >
            <Icon
              name={loading ? 'Loader2' : 'RefreshCw'}
              size={14}
              className={`mr-1 ${loading ? 'animate-spin' : ''}`}
            />
            Обновить
          </Button>
        </div>

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить планировщик"
            description={listError}
            onRetry={load}
          />
        )}

        {!loading && !listError && (
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

        {!loading && tooOften > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <Icon name="Timer" size={24} className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              <p className="font-bold text-amber-900">
                Заданий запускается слишком часто: {tooOften}
              </p>
              <p className="mt-0.5 text-sm text-amber-900">
                Лишних запусков в месяц: {extraPerMonth.toLocaleString('ru-RU')}. Задания
                работают, но их дёргают чаще нужного — это оплачивается и перегружает базу.
                Поправьте расписание в планировщике у отмеченных заданий ниже
              </p>
            </div>
          </div>
        )}

        {loading && jobs.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <Tabs value={currentTab} onValueChange={setTab} className="min-w-0">
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
              {groups.map((g) => {
                const broken = brokenCount(jobs, g.key);
                return (
                  <TabsTrigger key={g.key} value={g.key} className="shrink-0 gap-1.5">
                    {TAB_SHORT[g.key] || g.title}
                    {broken > 0 ? (
                      <span className="rounded-full bg-amber-100 px-1.5 py-0 text-[11px] font-bold text-amber-900">
                        {broken}
                      </span>
                    ) : null}
                  </TabsTrigger>
                );
              })}
              <TabsTrigger value={RECONCILE_TAB} className="shrink-0">
                Сверка
              </TabsTrigger>
            </TabsList>

            {groups.map((g) => {
              const groupJobs = jobs.filter((j) => j.group === g.key);
              return (
                <TabsContent key={g.key} value={g.key} className="mt-4 space-y-3">
                  <p className="text-sm text-muted-foreground">{g.hint}</p>
                  {groupJobs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Заданий в этом разделе нет.</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {groupJobs.map((j) => (
                        <SchedulerJobCard key={j.key} job={j} />
                      ))}
                    </div>
                  )}
                </TabsContent>
              );
            })}

            <TabsContent value={RECONCILE_TAB} className="mt-4">
              <MarketplaceReconcile />
            </TabsContent>
          </Tabs>
        )}

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
