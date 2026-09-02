import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
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

  const isStorekeeper = isStorekeeperRole(user?.role);

  const load = useCallback(() => {
    if (!user?.id || !isStorekeeper) return;
    fetchStorekeeperTasks(user.id)
      .then((r) => {
        setShiftOpen(r.shiftOpen);
        setTasks(r.tasks);
      })
      .catch(() => setTasks([]));
  }, [user?.id, isStorekeeper]);

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

  const doneCount = tasks.filter((t) => t.done).length;
  const blocking = tasks.filter((t) => t.blocking && !t.done);
  const allDone = doneCount === tasks.length;

  const handleToggle = async (task: StorekeeperTask) => {
    if (!user?.id || !task.manual) return;
    setBusyKey(task.key);
    try {
      await toggleStorekeeperTask(user.id, task.key);
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
      className={`fixed right-3 top-16 z-40 w-[17rem] rounded-xl border shadow-lg backdrop-blur transition-all duration-200 sm:right-4 ${
        open
          ? 'border-border bg-card opacity-100'
          : 'border-border/50 bg-card/60 opacity-60 hover:opacity-100'
      }`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Icon
          name={allDone ? 'CircleCheckBig' : 'ClipboardList'}
          size={16}
          className={allDone ? 'shrink-0 text-emerald-600' : 'shrink-0 text-primary'}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold leading-tight">
            Задания смены
          </span>
          <span className="block text-[11px] leading-tight text-muted-foreground">
            {allDone
              ? 'Всё выполнено — можно закрывать смену'
              : `Выполнено ${doneCount} из ${tasks.length}`}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
            allDone
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-primary/10 text-primary'
          }`}
        >
          {doneCount}/{tasks.length}
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
          style={{ width: `${(doneCount / tasks.length) * 100}%` }}
        />
      </div>

      {open && (
        <div className="max-h-[60vh] space-y-1 overflow-y-auto p-2">
          {tasks.map((t) => (
            <div
              key={t.key}
              className={`flex items-start gap-2 rounded-lg border p-2 transition-colors ${
                t.done
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
                disabled={!t.manual || busyKey === t.key}
                onClick={() => handleToggle(t)}
                title={
                  t.manual
                    ? 'Отметить выполненным'
                    : 'Галочка встанет сама, когда работа будет сделана'
                }
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors ${
                  t.done
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-muted-foreground/40 bg-background'
                } ${t.manual ? 'cursor-pointer hover:border-emerald-500' : 'cursor-default'}`}
              >
                {busyKey === t.key ? (
                  <Icon name="Loader2" size={12} className="animate-spin" />
                ) : t.done ? (
                  <Icon name="Check" size={12} />
                ) : null}
              </button>

              <button
                type="button"
                onClick={() => navigate(t.link)}
                className="min-w-0 flex-1 text-left"
              >
                <span
                  className={`block text-[11px] font-semibold leading-snug ${
                    t.done ? 'text-muted-foreground line-through' : ''
                  }`}
                >
                  {t.title}
                </span>
                <span className="block text-[10px] leading-snug text-muted-foreground">
                  {t.hint}
                </span>
              </button>

              {t.count > 0 && !t.done && (
                <span className="mt-0.5 shrink-0 rounded-md bg-amber-200 px-1.5 text-[11px] font-bold text-amber-900">
                  {t.count}
                </span>
              )}
            </div>
          ))}

          {blocking.length > 0 && (
            <p className="px-1 pt-1 text-[10px] leading-snug text-amber-700">
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
