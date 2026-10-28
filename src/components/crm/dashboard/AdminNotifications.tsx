import { useEffect, useMemo, useState } from 'react';
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
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import { formatDateTime } from '@/lib/dateUtils';
import { roleLabels, type Role } from '@/lib/roles';

/** Иконка и человеческое имя типа события — админ узнаёт его с одного взгляда. */
const KINDS: Record<string, { icon: string; label: string }> = {
  send_to_sewing: { icon: 'Shirt', label: 'Отправлено перешивать' },
  repack_utilized: { icon: 'Trash2', label: 'Утилизация на перепаковке' },
  // Товар числился на полке, а физически его нет — расхождение остатков.
  not_found: { icon: 'SearchX', label: 'Не нашли на полке' },
  // Недостача по рулону сверх нормы поставщика — стоит денег.
  roll_shortage: { icon: 'Scissors', label: 'Недостача рулона' },
  // Кусок брака оформили в цехе, но до склада он не доехал.
  defect_missing: { icon: 'PackageX', label: 'Брак не доехал' },
  // Кладовщик при приёмке с ПВЗ увидел в пакете не тот товар.
  pvz_substitution: { icon: 'ArrowLeftRight', label: 'Подмена на ПВЗ' },
};

const kindOf = (kind: string) => KINDS[kind] || { icon: 'Info', label: 'Прочее' };

/** Участки: у кого проблема. Админ проверяет каждый участок отдельно. */
type Area = 'cutters' | 'sewers' | 'repack' | 'warehouse' | 'other';
const AREAS: { key: Area; label: string; icon: string }[] = [
  { key: 'cutters', label: 'Закройщики', icon: 'Scissors' },
  { key: 'sewers', label: 'Швеи', icon: 'Shirt' },
  { key: 'repack', label: 'Перепаковка и упаковка', icon: 'Package' },
  { key: 'warehouse', label: 'Склад', icon: 'Warehouse' },
  { key: 'other', label: 'Прочее', icon: 'Info' },
];

const areaOf = (n: AdminNotification): Area => {
  if (n.kind === 'not_found' || n.kind === 'pvz_substitution' || n.kind === 'send_to_sewing') return 'warehouse';
  if (n.kind === 'repack_utilized') return 'repack';
  switch (n.actorRole) {
    case 'cutter':
      return 'cutters';
    case 'sewer':
      return 'sewers';
    case 'packer':
    case 'packer_returns':
      return 'repack';
    case 'storekeeper':
    case 'senior_storekeeper':
      return 'warehouse';
    default:
      return 'other';
  }
};

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
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState<Area | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  const byArea = useMemo(() => {
    const m = new Map<Area, AdminNotification[]>();
    for (const n of items) {
      const a = areaOf(n);
      m.set(a, [...(m.get(a) || []), n]);
    }
    return m;
  }, [items]);
  const areas = AREAS.filter((a) => (byArea.get(a.key) || []).length > 0);
  const currentArea: Area | null =
    area && byArea.get(area)?.length ? area : areas[0]?.key ?? null;
  const areaItems = useMemo(
    () => (currentArea ? byArea.get(currentArea) || [] : []),
    [byArea, currentArea],
  );

  const people = useMemo(() => {
    const m = new Map<string, { name: string; role: string | null; count: number; kinds: Map<string, number> }>();
    for (const n of areaItems) {
      const name = n.actorName || 'Система';
      const p = m.get(name) || { name, role: n.actorRole ?? null, count: 0, kinds: new Map() };
      p.count += 1;
      p.kinds.set(n.kind, (p.kinds.get(n.kind) || 0) + 1);
      m.set(name, p);
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [areaItems]);
  const areaKinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of areaItems) m.set(n.kind, (m.get(n.kind) || 0) + 1);
    return [...m.entries()];
  }, [areaItems]);
  const visible = areaItems.filter(
    (n) => (!person || (n.actorName || 'Система') === person) && (!kindFilter || n.kind === kindFilter),
  );
  const pickArea = (a: Area) => {
    setArea(a);
    setPerson(null);
    setKindFilter(null);
  };

  const load = () => {
    fetchAdminNotifications()
      .then((d) => {
        setListError(null);
        setItems(d.items);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить уведомления');
      });
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

  if (items.length === 0 && !listError) return null;

  if (listError && items.length === 0) {
    return (
      <WarehouseFetchError
        title="Не удалось загрузить уведомления склада"
        description={listError}
        onRetry={load}
      />
    );
  }

  // Счётчики по типам: «5 не нашли на полке, 2 недостачи» полезнее, чем семь
  // строк подряд, из которых надо самому вылавливать закономерность.

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
              {areas.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className="flex items-center gap-1 hover:underline"
                  onClick={() => {
                    pickArea(a.key);
                    setOpen(true);
                  }}
                >
                  <Icon name={a.icon} size={13} className="shrink-0 text-amber-700" />
                  {a.label}: <b>{byArea.get(a.key)?.length}</b>
                </button>
              ))}
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
        <DialogContent className="flex h-[85vh] max-w-4xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3 sm:px-5">
            <DialogTitle className="text-base">Уведомления склада</DialogTitle>
            <DialogDescription className="text-xs">
              Решения склада, которые стоят денег. Записи не удаляются — история остаётся
              в журнале.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1 border-b px-4 py-2 sm:px-5">
            {areas.map((a) => (
              <Button
                key={a.key}
                size="sm"
                variant={currentArea === a.key ? 'default' : 'outline'}
                className="h-8"
                onClick={() => pickArea(a.key)}
              >
                <Icon name={a.icon} size={14} className="mr-1.5" />
                {a.label}
                <span className="ml-1.5 tabular-nums opacity-70">{byArea.get(a.key)?.length}</span>
              </Button>
            ))}
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden sm:grid-cols-[220px_1fr]">
            <div className="max-h-40 overflow-y-auto border-b sm:max-h-none sm:border-b-0 sm:border-r">
              <button
                type="button"
                onClick={() => setPerson(null)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                  !person ? 'bg-muted font-medium' : 'hover:bg-muted/50'
                }`}
              >
                Все сотрудники
                <span className="tabular-nums text-muted-foreground">{areaItems.length}</span>
              </button>
              {people.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setPerson(p.name)}
                  className={`w-full px-3 py-2 text-left ${
                    person === p.name ? 'bg-muted' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 text-xs font-semibold tabular-nums text-amber-900">
                      {p.count}
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {p.role ? roleLabels[p.role as Role] || p.role : ''}
                    {[...p.kinds.entries()].map(([k, c]) => ` · ${kindOf(k).label.toLowerCase()} ${c}`).join('')}
                  </p>
                </button>
              ))}
            </div>

            <div className="flex min-h-0 flex-col">
              <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2">
                {areaKinds.length > 1 &&
                  [null, ...areaKinds.map(([k]) => k)].map((k) => (
                    <button
                      key={k ?? 'all'}
                      type="button"
                      onClick={() => setKindFilter(k)}
                      className={`rounded px-2 py-0.5 text-xs ${
                        kindFilter === k ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {k ? kindOf(k).label : 'Все типы'}
                    </button>
                  ))}
                {visible.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 text-xs"
                    disabled={busy}
                    onClick={() => dismiss(visible.map((n) => n.id))}
                  >
                    Убрать показанные ({visible.length})
                  </Button>
                )}
              </div>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {visible.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">Всё разобрано</p>
                )}
                {visible.map((n) => (
                  <div
                    key={n.id}
                    className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3"
                  >
                    <Icon name={kindOf(n.kind).icon} size={18} className="mt-0.5 shrink-0 text-amber-600" />
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
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AdminNotifications;
