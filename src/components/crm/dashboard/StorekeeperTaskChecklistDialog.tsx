import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  fetchStorekeeperTasks,
  adminCloseStorekeeperTask,
  type StorekeeperTask,
} from '@/lib/shiftSessionsApi';

interface StorekeeperTaskChecklistDialogProps {
  /** Кладовщик, чей чек-лист смотрим. null — диалог закрыт. */
  employee: { id: number; fullName: string } | null;
  onClose: () => void;
  /** Задание закрыли/переоткрыли — список статусов на дашборде стоит обновить. */
  onChanged?: () => void;
}

/**
 * Чек-лист кладовщика глазами администратора — с кнопкой закрыть пункт ЗА него.
 *
 * ЗАЧЕМ. Кладовщик не может закрыть смену, пока в чек-листе висит работа. Обычно
 * это правильно — работа физически не сделана. Но бывают нештатные ситуации: сбой
 * синхронизации, битая запись в базе, задание застряло из-за ошибки, а разобраться
 * с первопричиной прямо сейчас нельзя, а человеку пора домой. Тогда администратор
 * снимает блокировку с конкретного пункта вручную.
 *
 * ГЛАВНОЕ ПРАВИЛО: отметка живёт только в рамках ТЕКУЩЕЙ открытой смены кладовщика.
 * Завтра он откроет новую смену — чек-лист посчитается заново по живым данным
 * склада, без каких-либо следов вчерашнего вмешательства.
 */
const StorekeeperTaskChecklistDialog = ({
  employee,
  onClose,
  onChanged,
}: StorekeeperTaskChecklistDialogProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<StorekeeperTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = () => {
    if (!employee) return;
    setLoading(true);
    fetchStorekeeperTasks(employee.id)
      .then((r) => setTasks(r.tasks))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.id]);

  const handleAdminClose = async (task: StorekeeperTask) => {
    if (!employee || !user?.id) return;
    setBusyKey(task.key);
    try {
      const r = await adminCloseStorekeeperTask(employee.id, task.key, user.id);
      toast({
        title: r.closed ? 'Задание закрыто' : 'Отметка снята',
        description: task.title,
      });
      load();
      onChanged?.();
    } catch (e) {
      toast({
        title: 'Не получилось',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Dialog open={!!employee} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Задания смены — {employee?.fullName}</DialogTitle>
        </DialogHeader>

        <p className="text-xs leading-snug text-muted-foreground">
          Кнопка «Закрыть» — для нештатных случаев: работа физически не сделана
          (счётчик это покажет), но задание перестанет держать смену. Завтра, в
          новой смене, список посчитается заново — этот шаг на него не повлияет.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : tasks.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            У сотрудника нет открытой смены или заданий.
          </p>
        ) : (
          <div className="space-y-1.5">
            {tasks.map((t) => (
              <div
                key={t.key}
                className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${
                  t.idle
                    ? 'border-dashed border-border bg-transparent opacity-45'
                    : t.done
                      ? 'border-emerald-200 bg-emerald-50/60'
                      : t.blocking
                        ? 'border-amber-200 bg-amber-50/60'
                        : 'border-border bg-muted/30'
                }`}
              >
                <span
                  className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border ${
                    t.done
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : t.idle
                        ? 'border-dashed border-muted-foreground/30 bg-transparent'
                        : 'border-muted-foreground/40 bg-background'
                  }`}
                >
                  {t.done && <Icon name="Check" size={14} />}
                </span>

                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[13px] font-semibold leading-snug ${
                      t.done && !t.idle ? 'text-muted-foreground line-through' : ''
                    }`}
                  >
                    {t.title}
                    {t.count > 0 && (
                      <span className="ml-1 font-normal text-muted-foreground">
                        ({t.count})
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">
                    {t.idle ? 'Сегодня такой работы не появлялось' : t.hint}
                  </span>
                  {/* Разбивка «что и по сколько штук» — админу видно, какая
                      именно работа держит смену кладовщика. */}
                  {!t.done && !t.idle && t.items && t.items.length > 0 && (
                    <span className="mt-1.5 block space-y-0.5">
                      {t.items.map((it) => (
                        <span
                          key={it.name}
                          className="flex items-center justify-between gap-2 rounded bg-background/70 px-1.5 py-0.5 text-[11px] leading-snug"
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {it.name}
                          </span>
                          <span className="shrink-0 font-bold tabular-nums text-amber-900">
                            {it.qty} шт
                          </span>
                        </span>
                      ))}
                    </span>
                  )}
                  {t.adminClosed && (
                    <span className="mt-1 flex items-center gap-1 text-[10px] font-medium leading-snug text-sky-700">
                      <Icon name="ShieldCheck" size={10} />
                      Закрыто администратором — работа может быть не сделана
                    </span>
                  )}
                  {t.claimedBy && !t.done && (
                    <span className="mt-1 flex items-center gap-1 text-[10px] font-medium leading-snug text-emerald-700">
                      <Icon name="User" size={10} />
                      Взял на себя: {t.claimedByName}
                    </span>
                  )}
                </span>

                {/* Закрывать за кладовщика можно только реально держащие смену
                    пункты: ручные (галочка) и приглушённые (idle) её и так не
                    держат — трогать там нечего. */}
                {t.blocking && !t.manual && !t.idle && (
                  <Button
                    size="sm"
                    variant={t.adminClosed ? 'outline' : 'secondary'}
                    className="h-7 shrink-0 px-2 text-[11px]"
                    disabled={busyKey === t.key}
                    onClick={() => handleAdminClose(t)}
                  >
                    {busyKey === t.key ? (
                      <Icon name="Loader2" size={12} className="animate-spin" />
                    ) : t.adminClosed ? (
                      'Вернуть'
                    ) : (
                      'Закрыть'
                    )}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default StorekeeperTaskChecklistDialog;