import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchAdminNotifications,
  dismissNotifications,
  type AdminNotification,
} from '@/lib/goodsWarehouseApi';
import { formatDateTime } from '@/lib/dateUtils';

/** Иконка события по типу — чтобы админ узнавал уведомление с одного взгляда. */
const kindIcons: Record<string, string> = {
  send_to_sewing: 'Shirt',
  // Товар числился на полке, а физически его нет — расхождение остатков.
  not_found: 'SearchX',
  // Недостача по рулону сверх нормы поставщика — стоит денег.
  roll_shortage: 'Scissors',
  // Кусок брака оформили в цехе, но до склада он не доехал.
  defect_missing: 'PackageX',
};

/**
 * Уведомления администратору на панели.
 *
 * Сюда попадают решения склада, которые стоят денег: например, кладовщик списал готовую
 * вещь и отправил заказ шиться заново. Раньше такое оставалось только в журнале, куда
 * никто не заглядывает — админ узнавал о списании случайно.
 *
 * Уведомление можно открыть (перейдёт в карточку товара) или убрать. Записи не удаляются
 * физически: история решений по складу остаётся целой.
 */
const AdminNotifications = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<AdminNotification[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetchAdminNotifications()
      .then((d) => setItems(d.items))
      .catch(() => setItems([]));
  };

  useEffect(() => {
    load();
  }, []);

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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Icon name="Bell" size={18} className="text-amber-600" />
          Уведомления
          <span className="rounded-full bg-amber-100 px-2 text-sm text-amber-700">
            {items.length}
          </span>
        </h2>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => dismiss([])}
        >
          Очистить все
        </Button>
      </div>

      <div className="space-y-2">
        {items.map((n) => (
          <div
            key={n.id}
            className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3"
          >
            <Icon
              name={kindIcons[n.kind] || 'Info'}
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
                <Button size="sm" variant="outline" onClick={() => navigate(n.link!)}>
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
    </div>
  );
};

export default AdminNotifications;