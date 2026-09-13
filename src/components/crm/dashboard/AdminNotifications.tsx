import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchAdminNotifications,
  dismissNotifications,
  type AdminNotification,
} from '@/lib/goodsWarehouseApi';
import { formatDateTime } from '@/lib/dateUtils';

/** Иконка и человеческое имя типа события — админ узнаёт его с одного взгляда. */
const KINDS: Record<string, { icon: string; label: string }> = {
  send_to_sewing: { icon: 'Shirt', label: 'Отправлено перешивать' },
  // Товар числился на полке, а физически его нет — расхождение остатков.
  not_found: { icon: 'SearchX', label: 'Не нашли на полке' },
  // Недостача по рулону сверх нормы поставщика — стоит денег.
  roll_shortage: { icon: 'Scissors', label: 'Недостача рулона' },
  // Кусок брака оформили в цехе, но до склада он не доехал.
  defect_missing: { icon: 'PackageX', label: 'Брак не доехал' },
};

const kindOf = (kind: string) => KINDS[kind] || { icon: 'Info', label: 'Прочее' };

/**
 * Уведомления администратору на панели.
 *
 * Сюда попадают решения склада, которые стоят денег: например, кладовщик списал готовую
 * вещь и отправил заказ шиться заново. Раньше такое оставалось только в журнале, куда
 * никто не заглядывает — админ узнавал о списании случайно.
 *
 * На самой панели живёт одна строка со счётчиками по типам событий. Полный список
 * раньше печатался прямо на главной: тридцать одинаковых жёлтых плашек отодвигали
 * вниз всё остальное, и панель начинала читаться как лента, а не как сводка.
 * Разбор открывается по кнопке — там же уведомление можно открыть или убрать.
 */
const AdminNotifications = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<AdminNotification[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = () => {
    fetchAdminNotifications()
      .then((d) => setItems(d.items))
      .catch(() => setItems([]));
  };

  useEffect(load, []);

  const dismiss = async (ids: number[]) => {
    setBusy(true);
    try {
      await dismissNotifications(ids, user?.id, user?.name);
      load();
    } catch (e) {
      toast({
        title: 'Не удалось убрать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  if (items.length === 0) return null;

  // Счётчики по типам: «5 не нашли на полке, 2 недостачи» полезнее, чем семь
  // строк подряд, из которых надо самому вылавливать закономерность.
  const counts = new Map<string, number>();
  for (const n of items) counts.set(n.kind, (counts.get(n.kind) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <>
      <Card className="border-amber-300 bg-amber-50 shadow-none">
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
          <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700">
            <Icon name="Bell" size={20} />
            <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-amber-600 px-1 text-[11px] font-bold text-white">
              {items.length}
            </span>
          </span>

          <div className="min-w-[180px] flex-1">
            <p className="text-sm font-semibold text-amber-900">Уведомления склада</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-amber-900">
              {groups.map(([kind, count]) => {
                const k = kindOf(kind);
                return (
                  <span key={kind} className="flex items-center gap-1">
                    <Icon name={k.icon} size={13} className="shrink-0 text-amber-700" />
                    {k.label}: <b>{count}</b>
                  </span>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => dismiss([])}>
              Очистить все
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Разобрать
              <Icon name="ChevronRight" size={14} className="ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3 sm:px-5">
            <DialogTitle className="text-base">Уведомления склада</DialogTitle>
            <DialogDescription className="text-xs">
              Решения склада, которые стоят денег. Записи не удаляются — история остаётся
              в журнале.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4 sm:p-5">
            {items.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Всё разобрано
              </p>
            )}
            {items.map((n) => (
              <div
                key={n.id}
                className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3"
              >
                <Icon
                  name={kindOf(n.kind).icon}
                  size={18}
                  className="mt-0.5 shrink-0 text-amber-600"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-amber-900">{n.title}</p>
                  {n.message && <p className="text-sm text-amber-900">{n.message}</p>}
                  <p className="mt-0.5 text-xs text-amber-800">
                    {n.actorName || 'Система'} · {formatDateTime(n.createdAt || '')}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {n.link && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setOpen(false);
                        navigate(n.link!);
                      }}
                    >
                      Открыть
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => dismiss([n.id])}
                    aria-label="Убрать уведомление"
                  >
                    <Icon name="X" size={16} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AdminNotifications;
