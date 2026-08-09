import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchCleanupInfo,
  runCleanup,
  type CleanupInfo,
} from '@/lib/systemCleanupApi';

/** Что именно пропадёт — человеческим языком, без названий таблиц. */
const GROUP_HINTS: Record<string, string> = {
  orders:
    'Все заказы с маркетплейсов, поставки, отгрузки, возвраты, отзывы и готовый товар на полках',
  warehouse: 'Рулоны, поставки материала от поставщиков, зафиксированный брак',
  salary: 'Все начисления, выплаты, история смен, штрафы и отпуска',
  documents:
    'Подписанные договоры, сканы паспортов и СНИЛС, паспортные данные и реквизиты СБП',
  catalogs:
    'Материалы, товары в номенклатуре, расценки, полки, вешалки, поставщики',
  employees:
    'Все учётные записи, кроме администраторов. Люди зарегистрируются заново через MAX',
  audit: 'История действий пользователей в системе',
};

/** Очистка системы перед запуском на реальной работе.
 *
 * Операция необратимая, поэтому защит несколько: выбор групп галочками, показ
 * количества записей, ввод слова-подтверждения и отдельный экран проверки. */
const SystemCleanup = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [info, setInfo] = useState<CleanupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState('');
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<'select' | 'confirm'>('select');
  const [done, setDone] = useState<{ table: string; removed: number }[] | null>(null);

  const load = () => {
    if (!user?.id) return;
    setLoading(true);
    fetchCleanupInfo(user.id)
      .then(setInfo)
      .catch((e) =>
        toast({
          title: 'Не удалось загрузить',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        })
      )
      .finally(() => setLoading(false));
  };

  useEffect(load, [user?.id]);

  const toggle = (key: string) =>
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );

  const selectAll = () => setSelected(info ? info.groups.map((g) => g.key) : []);

  const handleRun = async () => {
    if (!user?.id || !info) return;
    setRunning(true);
    try {
      const res = await runCleanup({
        actorId: user.id,
        groups: selected,
        confirm,
      });
      setDone(res.removed);
      setInfo({ ...info, counts: res.counts });
      setSelected([]);
      setConfirm('');
      setStage('select');
      toast({ title: 'Система очищена' });
    } catch (e) {
      toast({
        title: 'Не удалось очистить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setRunning(false);
    }
  };

  const countByTable = (t: string) =>
    info?.counts.find((c) => c.table === t)?.count ?? 0;

  const totalRows = info?.counts.reduce((s, c) => s + c.count, 0) ?? 0;

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Очистка системы</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Удаление рабочих данных перед запуском на реальной работе
          </p>
        </div>

        <Card className="border-destructive/40 bg-destructive/5 shadow-none">
          <CardContent className="flex items-start gap-3 py-4">
            <Icon
              name="TriangleAlert"
              size={22}
              className="mt-0.5 shrink-0 text-destructive"
            />
            <div>
              <p className="font-bold text-destructive">
                Удалённые данные восстановить нельзя
              </p>
              <p className="text-sm text-destructive">
                Резервной копии нет. Убедитесь, что все выплаты сотрудникам закрыты, а
                нужные отчёты выгружены
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardContent className="py-4">
            <p className="font-bold">Что сохранится в любом случае</p>
            <div className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
              <p>· Учётные записи администраторов</p>
              <p>· Реквизиты ИП и настройки системы</p>
              <p>· Ключи интеграций с маркетплейсами</p>
              <p>· Цеха и их настройки</p>
            </div>
          </CardContent>
        </Card>

        {done && (
          <Card className="border-emerald-300 bg-emerald-50 shadow-none">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <Icon
                  name="CircleCheck"
                  size={22}
                  className="mt-0.5 shrink-0 text-emerald-600"
                />
                <div>
                  <p className="font-bold text-emerald-900">Очистка завершена</p>
                  {done.length === 0 ? (
                    <p className="text-sm text-emerald-900">Удалять было нечего</p>
                  ) : (
                    <p className="text-sm text-emerald-900">
                      Удалено записей:{' '}
                      {done.reduce((s, d) => s + d.removed, 0)}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : !info ? null : stage === 'select' ? (
          <>
            <Card className="shadow-none">
              <CardContent className="space-y-3 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-bold">Что удалить</p>
                  <Button variant="outline" size="sm" onClick={selectAll}>
                    Выбрать всё
                  </Button>
                </div>

                {info.groups.map((g) => (
                  <label
                    key={g.key}
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-accent/40"
                  >
                    <Checkbox
                      checked={selected.includes(g.key)}
                      onCheckedChange={() => toggle(g.key)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <p className="font-medium">{g.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {GROUP_HINTS[g.key]}
                      </p>
                    </div>
                  </label>
                ))}
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardContent className="py-4">
                <p className="font-bold">Сейчас в системе</p>
                <div className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {info.counts.map((c) => (
                    <div
                      key={c.table}
                      className="flex justify-between gap-3 border-b border-border/60 py-1"
                    >
                      <span className="text-muted-foreground">{c.label}</span>
                      <span className="font-medium tabular-nums">{c.count}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Всего записей: <span className="font-bold">{totalRows}</span>
                </p>
              </CardContent>
            </Card>

            <Button
              variant="destructive"
              disabled={selected.length === 0}
              onClick={() => setStage('confirm')}
            >
              <Icon name="Trash2" size={16} className="mr-1.5" />
              Перейти к подтверждению
            </Button>
          </>
        ) : (
          <Card className="border-destructive/50 shadow-none">
            <CardContent className="space-y-4 py-5">
              <div>
                <p className="font-bold text-destructive">Последняя проверка</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Будет безвозвратно удалено:
                </p>
              </div>

              <div className="space-y-1.5">
                {info.groups
                  .filter((g) => selected.includes(g.key))
                  .map((g) => (
                    <div key={g.key} className="flex items-start gap-2 text-sm">
                      <Icon
                        name="X"
                        size={15}
                        className="mt-0.5 shrink-0 text-destructive"
                      />
                      <span>{g.title}</span>
                    </div>
                  ))}
              </div>

              {selected.includes('employees') && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  Будет удалено сотрудников: {countByTable('users')}. Им придётся
                  зарегистрироваться заново, а вам — утвердить их должности
                </div>
              )}

              <div className="space-y-1.5">
                <Label>
                  Введите слово{' '}
                  <span className="font-bold">{info.confirmPhrase}</span> для
                  подтверждения
                </Label>
                <Input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={info.confirmPhrase}
                  autoComplete="off"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  disabled={
                    running ||
                    confirm.trim().toUpperCase() !== info.confirmPhrase
                  }
                  onClick={handleRun}
                >
                  {running ? (
                    <Icon name="Loader2" size={16} className="mr-1.5 animate-spin" />
                  ) : (
                    <Icon name="Trash2" size={16} className="mr-1.5" />
                  )}
                  Очистить безвозвратно
                </Button>
                <Button
                  variant="ghost"
                  disabled={running}
                  onClick={() => {
                    setStage('select');
                    setConfirm('');
                  }}
                >
                  Назад
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </CrmLayout>
  );
};

export default SystemCleanup;
