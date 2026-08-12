import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchVacationRight,
  fetchVacations,
  createVacation,
  cancelVacation,
  type Vacation,
  type VacationRight,
} from '@/lib/vacationsApi';

/** Должности, которым отпуск оформляется по графику. */
const VACATION_ROLES = ['sewer', 'cutter', 'packer', 'storekeeper', 'senior_storekeeper', 'cleaner'];

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

interface VacationSectionProps {
  userId: number;
  role: string;
  actorId?: number | null;
}

/**
 * Отпуска сотрудника в его карточке.
 *
 * Правила: отпуск длится 2 недели, за рабочий год положено 2 отпуска (год считается
 * от даты первого отпуска, а не с января). Одновременно от смены может отдыхать только
 * один человек — иначе смене некому работать. Все проверки делает сервер, здесь мы
 * показываем ближайшую доступную дату и понятную причину отказа.
 */
const VacationSection = ({ userId, role, actorId }: VacationSectionProps) => {
  const { toast } = useToast();
  const [right, setRight] = useState<VacationRight | null>(null);
  const [items, setItems] = useState<Vacation[]>([]);
  const [startsOn, setStartsOn] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    // Список отпусков тянем отдельно от права на отпуск: если связь моргнула и один
    // запрос не дошёл, вторая половина блока всё равно наполнится.
    fetchVacations()
      .then((list) => setItems(list.filter((v) => v.userId === userId && !v.cancelled)))
      .catch(() => {});
    // Кружок загрузки снимаем по главному запросу блока.
    fetchVacationRight(userId)
      .then((r) => {
        setRight(r);
        if (r.nextDate) setStartsOn(r.nextDate.slice(0, 10));
      })
      .catch(() => setRight(null))
      .finally(() => setLoading(false));
  };

  useEffect(load, [userId]);

  if (!VACATION_ROLES.includes(role)) return null;

  const handleCreate = async () => {
    if (!startsOn) return;
    setSaving(true);
    try {
      const res = await createVacation({ userId, startsOn, actorId });
      toast({
        title: 'Отпуск оформлен',
        description: `с ${fmt(res.startsOn)} по ${fmt(res.endsOn)}`,
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось оформить отпуск',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id: number) => {
    try {
      await cancelVacation(id, actorId);
      toast({ title: 'Отпуск отменён' });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось отменить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <Icon name="Palmtree" size={18} className="text-muted-foreground" />
        <p className="text-sm font-medium">Отпуск</p>
        {right && right.perYear && (
          <Badge variant="secondary">
            {right.usedInYear} из {right.perYear} за год
          </Badge>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : (
        <>
          {/* Без даты первого отпуска отсчёт рабочего года вести не от чего —
              она задаётся при оформлении первого отпуска и дальше не меняется. */}
          <p className="text-xs text-muted-foreground">
            {right?.firstVacationDate
              ? `Первый отпуск: ${fmt(right.firstVacationDate)}. Рабочий год ${right.workYear}-й, отпуск на 14 дней`
              : 'Дата первого отпуска ещё не задана — она установится по первому оформленному отпуску'}
          </p>

          {right?.nextDate && (
            <p className="text-sm">
              Ближайший возможный отпуск: <b>{fmt(right.nextDate)}</b>
            </p>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Дата начала</Label>
              <Input
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                className="w-44"
              />
            </div>
            <Button onClick={handleCreate} disabled={saving || !startsOn}>
              {saving ? (
                <Icon name="Loader2" size={16} className="mr-1 animate-spin" />
              ) : (
                <Icon name="Palmtree" size={16} className="mr-1" />
              )}
              Оформить отпуск
            </Button>
          </div>

          {items.length > 0 && (
            <div className="space-y-1.5">
              {items.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span>
                    {fmt(v.startsOn)} — {fmt(v.endsOn)}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {v.workYear}-й год
                    </span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => handleCancel(v.id)}>
                    Отменить
                  </Button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default VacationSection;