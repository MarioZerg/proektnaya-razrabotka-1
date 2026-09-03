import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import { playWarehouseAlert } from '@/lib/warehouseAlerts';
import {
  fetchStorekeeperTasks,
  toggleStorekeeperTask,
  type StorekeeperTask,
} from '@/lib/shiftSessionsApi';

/**
 * Задания кладовщика на смену — чек-лист поверх интерфейса.
 *
 * ЗАЧЕМ. Работа кладовщика состоит из дел, которые легко забыть к концу дня:
 * собрать вещи с полок, забрать из цеха отменённые, отгрузить поставку, разобрать
 * возвраты. Забытое всплывает наутро — маркетплейс не получил отправление, товар
 * лежит в цехе. Список собирает эти дела в одном месте и не даёт закрыть смену,
 * пока они висят.
 *
 * КАК СЕБЯ ВЕДЁТ. Висит полупрозрачным в правом верхнем углу, под балансом, и не
 * мешает работать. Наведёшь мышь (или коснёшься на планшете) — становится
 * непрозрачным, можно листать задания и переходить прямо из него.
 *
 * Галочки у большинства пунктов ставятся сами, когда работа сделана: список
 * обновляется каждые полминуты и после возвращения на вкладку. Два задания
 * система проверить не может — отгрузку ткани (материала может не быть) и
 * напоминание закройщикам про рулоны; их кладовщик отмечает сам.
 *
 * Показывается только кладовщику и только при открытой смене: пришёл на работу —
 * задания появились, закрыл смену — исчезли.
 */
const StorekeeperTasksWidget = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<StorekeeperTask[]>([]);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // Галочки в демо-режиме: настоящей смены нет, запоминать их негде — держим
  // на экране, чтобы администратор мог понажимать и посмотреть, как это работает.
  const [demoDone, setDemoDone] = useState<Set<string>>(new Set());

  const isStorekeeper = isStorekeeperRole(user?.role);
  // ПРОСМОТР ГЛАЗАМИ КЛАДОВЩИКА, БЕЗ ОТКРЫТОЙ СМЕНЫ.
  //
  // Администратор попадает сюда двумя путями: демо-вход (isDemo) и вход в
  // аккаунт сотрудника из раздела «Сотрудники» (isImpersonated). В обоих
  // случаях смены нет — и список бы просто не показался. Поэтому в этих
  // режимах считаем задания по живым данным склада и разрешаем нажимать
  // галочки: они никуда не сохраняются и на работу склада не влияют.
  const isDemo = !!user?.isDemo || !!user?.isImpersonated;

  const load = useCallback(() => {
    if (!user?.id || !isStorekeeper) return;
    fetchStorekeeperTasks(user.id, isDemo)
      .then((r) => {
        setShiftOpen(r.shiftOpen);
        setTasks(r.tasks);
      })
      .catch(() => setTasks([]));
  }, [user?.id, isStorekeeper, isDemo]);

  useEffect(() => {
    load();
    // Обновляем сами: кладовщик выполняет работу на других страницах, и список
    // должен догонять её без перезагрузки. Полминуты — незаметно для человека и
    // не нагружает систему.
    const timer = window.setInterval(load, 30000);
    // Вернулся на вкладку — сразу освежаем: за время отсутствия он мог сделать
    // работу на терминале склада.
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  if (!isStorekeeper || !shiftOpen || tasks.length === 0) return null;

  // В демо-режиме поверх настоящих данных накладываем галочки, нажатые на экране.
  const shown = isDemo
    ? tasks.map((t) => (demoDone.has(t.key) ? { ...t, done: true } : t))
    : tasks;

  const doneCount = shown.filter((t) => t.done).length;
  const blocking = shown.filter((t) => t.blocking && !t.done);
  const allDone = doneCount === shown.length;

  const handleToggle = async (task: StorekeeperTask) => {
    if (!user?.id) return;
    // ДЕМО: нажимается ЛЮБАЯ галочка, в том числе у автоматических заданий —
    // чтобы администратор увидел, как выглядит выполненный список целиком.
    // В базу это не пишется и на работу склада не влияет.
    if (isDemo) {
      setDemoDone((prev) => {
        const next = new Set(prev);
        if (next.has(task.key)) next.delete(task.key);
        else {
          next.add(task.key);
          // Звучим только когда галочка ВСТАЁТ. Снятие — исправление ошибки,
          // хвалить за него нечего.
          playWarehouseAlert('taskDone');
        }
        return next;
      });
      return;
    }
    if (!task.manual) return;
    setBusyKey(task.key);
    try {
      const res = await toggleStorekeeperTask(user.id, task.key);
      // Отбивка при появлении галочки. Идёт через общую очередь звуков склада:
      // если в этот момент говорит голосовое уведомление о новой работе, отбивка
      // дождётся своей очереди и не наложится на него.
      if (res.done) playWarehouseAlert('taskDone');
      load();
    } catch (e) {
      toast({
        title: 'Не удалось отметить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div
      // Полупрозрачный в покое, непрозрачный под курсором — не закрывает работу,
      // но всегда под рукой. На планшете раскрывается касанием по шапке.
      className={`fixed right-3 top-16 z-40 w-[21rem] rounded-xl border shadow-lg backdrop-blur transition-all duration-200 sm:right-4 ${
        open
          ? 'border-border bg-card opacity-100'
          : 'border-border/50 bg-card/60 opacity-60 hover:opacity-100'
      }`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* НАГРАДА ЗА ЗАКРЫТЫЙ ЧЕК-ЛИСТ.
          Появляется, когда выполнено ВСЁ, и выскакивает над виджетом с лёгким
          перелётом. Дальше еле заметно покачивается — глаз не устаёт.
          Стоит появиться новой работе (пришёл возврат, отменили заказ) —
          картинка исчезает сама и вернётся, только когда список снова закрыт.
          pointer-events-none: не перехватывает клики по заданиям под ней. */}
      {allDone && (
        // Два слоя, потому что анимации разные по смыслу: внешний выскакивает
        // один раз, внутренний качается бесконечно. В одном элементе они
        // затирали бы друг друга — вторая анимация сбрасывала бы transform.
        <span
          aria-hidden
          className="pointer-events-none absolute -top-16 right-2 z-10 animate-cheer-pop motion-reduce:animate-none"
        >
          <img
            src="/happy-done.png"
            alt=""
            className="h-24 w-auto animate-cheer-idle drop-shadow-[0_6px_12px_rgba(0,0,0,0.25)] motion-reduce:animate-none"
          />
        </span>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <Icon
          name={allDone ? 'CircleCheckBig' : 'ClipboardList'}
          size={18}
          className={allDone ? 'shrink-0 text-emerald-600' : 'shrink-0 text-primary'}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-tight">
            Задания смены
            {isDemo && (
              <span className="ml-1 rounded-sm bg-muted px-1 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                демо
              </span>
            )}
          </span>
          <span className="block text-xs leading-tight text-muted-foreground">
            {allDone
              ? 'Всё выполнено — можно закрывать смену'
              : `Выполнено ${doneCount} из ${shown.length}`}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 text-sm font-bold ${
            allDone
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-primary/10 text-primary'
          }`}
        >
          {doneCount}/{shown.length}
        </span>
        <Icon
          name={open ? 'ChevronUp' : 'ChevronDown'}
          size={14}
          className="shrink-0 text-muted-foreground"
        />
      </button>

      {/* Полоса выполнения: видно продвижение за день одним взглядом. */}
      <div className="mx-3 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            allDone ? 'bg-emerald-500' : 'bg-primary'
          }`}
          style={{ width: `${(doneCount / shown.length) * 100}%` }}
        />
      </div>

      {open && (
        <div className="max-h-[60vh] space-y-1 overflow-y-auto p-2">
          {shown.map((t) => (
            <div
              key={t.key}
              className={`flex items-start gap-2.5 rounded-lg border p-2.5 transition-colors ${
                t.idle
                  ? // РАБОТЫ ПО ЭТОМУ ДЕЛУ СЕГОДНЯ НЕ БЫЛО.
                    // Не выполненное задание и не висящее: поставок не создавали,
                    // возвраты не приезжали. Показываем бледной строкой без
                    // галочки — зачёркнутая выглядела бы как сделанная работа.
                    'border-dashed border-border bg-transparent opacity-45'
                  : t.done
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : t.blocking
                      ? 'border-amber-200 bg-amber-50/60'
                      : 'border-border bg-muted/30'
              }`}
            >
              {/* Галочка: у ручных заданий по ней жмут, у остальных она просто
                  показывает состояние — работа закрывает их сама. */}
              <button
                type="button"
                disabled={t.idle || (!t.manual && !isDemo) || busyKey === t.key}
                onClick={() => handleToggle(t)}
                title={
                  t.idle
                    ? 'Сегодня такой работы не появлялось'
                    : isDemo
                      ? 'Демо: нажмите, чтобы посмотреть, как ставится галочка'
                      : t.manual
                        ? 'Отметить выполненным'
                        : 'Галочка встанет сама, когда работа будет сделана'
                }
                className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border transition-colors ${
                  t.done
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : t.idle
                      ? 'border-dashed border-muted-foreground/30 bg-transparent'
                      : 'border-muted-foreground/40 bg-background'
                } ${
                  !t.idle && (t.manual || isDemo)
                    ? 'cursor-pointer hover:border-emerald-500'
                    : 'cursor-default'
                }`}
              >
                {busyKey === t.key ? (
                  <Icon name="Loader2" size={14} className="animate-spin" />
                ) : t.done ? (
                  <Icon name="Check" size={14} />
                ) : null}
              </button>

              <button
                type="button"
                onClick={() => navigate(t.link)}
                className="min-w-0 flex-1 text-left"
              >
                <span
                  className={`block text-[13px] font-semibold leading-snug ${
                    t.done && !t.idle ? 'text-muted-foreground line-through' : ''
                  }`}
                >
                  {t.title}
                </span>
                <span className="block text-[11px] leading-snug text-muted-foreground">
                  {t.idle ? 'Сегодня такой работы не появлялось' : t.hint}
                </span>
                {/* Метка отсечки. До 15:00 — предупреждение «успей собрать»,
                    после — объяснение, почему на странице цифра больше, чем
                    в задании: новое уже уехало в завтрашний список. */}
                {t.cutoff && !t.idle && !t.done && (
                  <span
                    className={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium leading-snug ${
                      t.cutoffPassed
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-sky-100 text-sky-800'
                    }`}
                  >
                    <Icon name={t.cutoffPassed ? 'Lock' : 'Clock'} size={10} />
                    {t.cutoffPassed
                      ? 'Список закрыт в 15:00 — новое уйдёт на завтра'
                      : 'Собрать до 15:00 — позже в эту смену не добавится'}
                  </span>
                )}
              </button>

              {t.count > 0 && !t.done && !t.idle && (
                <span className="mt-0.5 shrink-0 rounded-md bg-amber-200 px-1.5 text-[13px] font-bold text-amber-900">
                  {t.count}
                </span>
              )}
            </div>
          ))}

          {isDemo && (
            <p className="px-1 pt-1 text-[11px] leading-snug text-muted-foreground">
              Демо-просмотр: цифры настоящие, галочки нажимаются для примера и
              никуда не сохраняются. У кладовщика на смене сами закрываются все
              задания, кроме отгрузки ткани и напоминания про рулоны.
            </p>
          )}
          {/* Общее пояснение внизу — чтобы правило было понятно даже тому,
              кто впервые видит список. */}
          {shown.some((t) => t.cutoff) && (
            <p className="px-1 pt-1 text-[11px] leading-snug text-muted-foreground">
              {shown.some((t) => t.cutoffPassed)
                ? 'После 15:00 новая работа в задания смены не попадает — она уйдёт в список на завтра. Этот список можно закрыть полностью.'
                : 'Отмеченные задания копятся до 15:00. Всё, что придёт позже, попадёт в задания следующего дня — искать это перед закрытием смены не нужно.'}
            </p>
          )}
          {blocking.length > 0 && !isDemo && (
            <p className="px-1 pt-1 text-[11px] leading-snug text-amber-700">
              Смену нельзя закрыть, пока не сделано: {blocking.length} задание
              {blocking.length > 1 ? 'й' : ''}. Задания с галочкой вручную смену
              не держат.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default StorekeeperTasksWidget;
