import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { isStorekeeperRole } from '@/lib/roles';
import { useIsMobile } from '@/hooks/use-mobile';
import { playWarehouseAlert } from '@/lib/warehouseAlerts';
import StorekeeperTasksCollapsed from '@/components/crm/storekeeperTasks/StorekeeperTasksCollapsed';
import StorekeeperTasksHeader from '@/components/crm/storekeeperTasks/StorekeeperTasksHeader';
import StorekeeperTaskRow from '@/components/crm/storekeeperTasks/StorekeeperTaskRow';
import StorekeeperTasksNotes from '@/components/crm/storekeeperTasks/StorekeeperTasksNotes';
import {
  fetchStorekeeperTasks,
  toggleStorekeeperTask,
  claimStorekeeperTask,
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
  const [claimKey, setClaimKey] = useState<string | null>(null);
  // На телефоне виджет ведёт себя иначе: раскрывается только пальцем и занимает
  // всю ширину. Наведение мыши там не существует, а фиксированные 21rem не
  // помещались в экран 360 px — карточка уезжала за правый край.
  const isMobile = useIsMobile();
  // Галочки в демо-режиме: настоящей смены нет, запоминать их негде — держим
  // на экране, чтобы администратор мог понажимать и посмотреть, как это работает.
  const [demoDone, setDemoDone] = useState<Set<string>>(new Set());

  // СВЁРНУТ В ЗНАЧОК.
  //
  // Карточка висит в правом верхнем углу поверх страницы и перекрывает то, что
  // под ней: на многих экранах там кнопки. Полупрозрачность помогала видеть, но
  // не нажимать — клик всё равно уходил в виджет. Поэтому даём свернуть его в
  // маленький кружок: место под ним освобождается полностью.
  //
  // Выбор запоминаем в браузере — кладовщик сворачивает один раз, а не на
  // каждой странице заново.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('storekeeper_tasks_collapsed') === '1',
  );

  const toggleCollapsed = (v: boolean) => {
    setCollapsed(v);
    localStorage.setItem('storekeeper_tasks_collapsed', v ? '1' : '0');
    if (v) setOpen(false);
  };

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
  // Держат смену только СВОИ невыполненные дела: приглушённые (работы не было)
  // и взятые другим кладовщиком человека не держат — считаем так же, как сервер,
  // иначе виджет обещал бы одно, а закрытие смены отвечало другое.
  const blocking = shown.filter(
    (t) => t.blocking && !t.done && !t.idle && !t.claimedByOther,
  );
  const allDone = doneCount === shown.length;

  // «Беру на себя»: второй кладовщик увидит, что дело занято, и не побежит
  // делать ту же работу. Повторное нажатие отпускает задание.
  const handleClaim = async (task: StorekeeperTask) => {
    if (!user?.id || isDemo) return;
    setClaimKey(task.key);
    try {
      const r = await claimStorekeeperTask(user.id, task.key);
      toast({
        title: r.claimed ? 'Взяли на себя' : 'Отпустили задание',
        description: r.claimed
          ? `${task.title} — второй кладовщик это увидит`
          : task.title,
      });
      await load();
    } catch (e) {
      // Чаще всего — «уже взял другой»: показываем его имя как есть.
      toast({
        title: 'Не получилось',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      await load();
    } finally {
      setClaimKey(null);
    }
  };

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
    // Галочку можно поставить на ЛЮБОМ задании: бывает работа, которую
    // физически не закончить сегодня (вещь не отгрузить, товара нет), а смену
    // закрывать пора. Счётчик рядом остаётся честным — видно, что осталось.
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

  // СВЁРНУТЫЙ ВИД — маленький кружок со счётчиком.
  //
  // Занимает угол вместо всей карточки, поэтому кнопки под ним снова доступны.
  // Нажатие разворачивает список обратно.
  if (collapsed) {
    return (
      <StorekeeperTasksCollapsed
        doneCount={doneCount}
        total={shown.length}
        allDone={allDone}
        blockingCount={blocking.length}
        onExpand={() => toggleCollapsed(false)}
      />
    );
  }

  return (
    <div
      // Полупрозрачный в покое, непрозрачный под курсором — не закрывает работу,
      // но всегда под рукой. На планшете раскрывается касанием по шапке.
      //
      // На телефоне тянем во всю ширину (left+right вместо жёстких 21rem) и не
      // приглушаем: полупрозрачная карточка поверх узкого экрана мешает читать
      // и то, что под ней, и сам список.
      className={`fixed top-16 z-40 rounded-xl border shadow-lg backdrop-blur transition-all duration-200 ${
        isMobile ? 'inset-x-2' : 'right-3 w-[21rem] sm:right-4'
      } ${
        open || isMobile
          ? 'border-border bg-card opacity-100'
          : 'border-border/50 bg-card/60 opacity-60 hover:opacity-100'
      }`}
      // Мышью раскрываем только на компьютере: на сенсорном экране события
      // наведения срабатывают от случайного касания и список прыгает сам.
      onMouseEnter={isMobile ? undefined : () => setOpen(true)}
      onMouseLeave={isMobile ? undefined : () => setOpen(false)}
    >
      <StorekeeperTasksHeader
        allDone={allDone}
        isDemo={isDemo}
        doneCount={doneCount}
        total={shown.length}
        onToggleOpen={() => setOpen((v) => !v)}
        onCollapse={() => toggleCollapsed(true)}
      />

      {open && (
        <div className="max-h-[60vh] space-y-1 overflow-y-auto p-2">
          {shown.map((t) => (
            <StorekeeperTaskRow
              key={t.key}
              task={t}
              isDemo={isDemo}
              busyKey={busyKey}
              claimKey={claimKey}
              onToggle={handleToggle}
              onClaim={handleClaim}
              onNavigate={navigate}
            />
          ))}

          <StorekeeperTasksNotes
            shown={shown}
            isDemo={isDemo}
            blockingCount={blocking.length}
          />
        </div>
      )}
    </div>
  );
};

export default StorekeeperTasksWidget;
