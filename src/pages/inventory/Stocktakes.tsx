import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import StocktakeScanner from '@/components/crm/stocktakes/StocktakeScanner';
import StocktakeReportView from '@/components/crm/stocktakes/StocktakeReportView';
import {
  fetchActiveStocktake,
  fetchStocktakes,
  fetchStocktake,
  startStocktake,
  closeStocktake,
  approveStocktake,
  rejectStocktake,
  cancelStocktake,
  STOCKTAKE_STATUS_LABEL,
  type Stocktake,
} from '@/lib/stocktakesApi';
import { formatDateTime } from '@/lib/dateUtils';

/**
 * Инвентаризация склада готового товара.
 *
 * Кладовщик открывает пересчёт, обходит стеллажи и пикает складские стикеры GW.
 * Всё, что не отсканировано, попадает в недостачу. Закрыть — значит отправить
 * результат админу: списывает ненайденное только он. Так пересчёт не превращается
 * в способ тихо убрать со склада пропавшую вещь.
 */
const Stocktakes = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isStorekeeper = user?.role === 'storekeeper' || user?.role === 'senior_storekeeper';
  // Считать склад может кладовщик, а также админ: иначе вкладка выглядит для него
  // пустой страницей — ни начать пересчёт, ни досчитать за отсутствующего кладовщика.
  const canCount = isStorekeeper || isAdmin;

  const [active, setActive] = useState<Stocktake | null>(null);
  const [history, setHistory] = useState<Stocktake[]>([]);
  const [pending, setPending] = useState<Stocktake | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [act, list] = await Promise.all([fetchActiveStocktake(), fetchStocktakes()]);
      setActive(act);
      setHistory(list);
      // Инвентаризация, ждущая решения админа: показываем её отдельным блоком
      // с полным отчётом — админ должен видеть, что именно он подтверждает.
      const waiting = list.find((s) => s.status === 'pending_approval');
      setPending(waiting ? await fetchStocktake(waiting.id) : null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const reloadActive = async () => {
    const act = await fetchActiveStocktake();
    setActive(act);
  };

  const handleStart = async () => {
    setSaving(true);
    try {
      await startStocktake(user?.id, user?.name);
      toast({ title: 'Инвентаризация начата', description: 'Сканируйте стикеры GW с полок' });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось начать',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClose = async () => {
    if (!active) return;
    setSaving(true);
    try {
      const res = await closeStocktake(active.id, note, user?.id, user?.name);
      toast({
        title: 'Инвентаризация закрыта',
        description:
          res.missingCount > 0
            ? `Не найдено ${res.missingCount} — отправлено администратору на подтверждение`
            : 'Расхождений нет, отправлено администратору',
      });
      setNote('');
      load();
    } catch (e) {
      toast({
        title: 'Не удалось закрыть',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      const res = await approveStocktake(
        pending.id,
        pending.report?.missingCount ?? 0,
        user?.id,
        user?.name,
      );
      toast({
        title: 'Инвентаризация подтверждена',
        description: `Списано ненайденных: ${res.disposed}. Переставлено на верные полки: ${res.moved}`,
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось подтвердить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id: number) => {
    setSaving(true);
    try {
      await cancelStocktake(id, undefined, user?.id, user?.name);
      toast({
        title: 'Инвентаризация отменена',
        description: 'Товар не затронут — ничего не списано',
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось отменить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    if (!pending || !rejectReason.trim()) return;
    setSaving(true);
    try {
      await rejectStocktake(pending.id, rejectReason.trim(), user?.id, user?.name);
      toast({ title: 'Возвращено на пересчёт' });
      setRejectReason('');
      load();
    } catch (e) {
      toast({
        title: 'Не удалось вернуть',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Инвентаризация склада</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Пересчёт товара по полкам складскими стикерами GW. Ненайденные вещи списывает
            администратор после подтверждения
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            {/* ИДЁТ ПЕРЕСЧЁТ — рабочий экран кладовщика. */}
            {active && canCount && (
              <div className="space-y-4 rounded-lg border border-primary/40 bg-primary/5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>Инвентаризация №{active.id}</Badge>
                  <span className="text-sm text-muted-foreground">
                    начал {active.startedByName || '—'},{' '}
                    {active.startedAt ? formatDateTime(active.startedAt) : ''}
                  </span>
                </div>

                {active.status === 'rejected' && active.rejectReason && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    Администратор вернул на пересчёт: {active.rejectReason}
                  </div>
                )}

                <StocktakeScanner stocktake={active} onScanned={reloadActive} />

                {active.report && <StocktakeReportView report={active.report} />}

                <div className="space-y-2">
                  <Textarea
                    placeholder="Комментарий для администратора (необязательно): что смотрели, где расхождения"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                  />
                  <Button size="lg" className="w-full" onClick={handleClose} disabled={saving}>
                    <Icon name={saving ? 'Loader2' : 'Send'} size={18} className={`mr-2 ${saving ? 'animate-spin' : ''}`} />
                    Закрыть инвентаризацию и отправить администратору
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    После закрытия сканировать будет нельзя. Ненайденные вещи спишет
                    администратор
                  </p>
                  <Button
                    variant="ghost"
                    className="w-full text-muted-foreground"
                    onClick={() => handleCancel(active.id)}
                    disabled={saving}
                  >
                    <Icon name="Trash2" size={15} className="mr-1.5" />
                    Отменить инвентаризацию — открыл по ошибке
                  </Button>
                </div>
              </div>
            )}

            {!active && canCount && (
              <div className="rounded-md border border-dashed border-border p-6 text-center">
                <Icon name="ClipboardCheck" size={36} className="mx-auto text-muted-foreground" />
                <p className="mt-2 font-medium">Пересчёт не идёт</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Начните инвентаризацию и обойдите полки со сканером
                </p>
                <Button className="mt-4" onClick={handleStart} disabled={saving}>
                  <Icon name="Play" size={16} className="mr-1.5" />
                  Начать инвентаризацию
                </Button>
              </div>
            )}

            {/* ЖДЁТ АДМИНА — подтверждение и списание недостачи. */}
            {pending && (
              <div className="space-y-4 rounded-lg border border-amber-300 bg-amber-50/50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">Инвентаризация №{pending.id}</Badge>
                  <span className="font-semibold">Ждёт подтверждения администратора</span>
                  <span className="text-sm text-muted-foreground">
                    закрыл {pending.startedByName || '—'},{' '}
                    {pending.closedAt ? formatDateTime(pending.closedAt) : ''}
                  </span>
                </div>

                {pending.note && (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Комментарий кладовщика: </span>
                    {pending.note}
                  </p>
                )}

                {pending.report && <StocktakeReportView report={pending.report} />}

                {/* Считал и подтверждает один человек — двойного контроля нет.
                    Прямо не запрещаем (админ может доcчитывать за кладовщика), но
                    показываем это явно: списание товара должен видеть второй глаз. */}
                {isAdmin && pending.startedByName === user?.name && (
                  <div className="rounded-md border border-amber-400 bg-amber-100 p-3 text-sm text-amber-900">
                    Эту инвентаризацию считали вы сами — подтверждая её, вы списываете
                    товар без второй проверки
                  </div>
                )}

                {isAdmin ? (
                  <div className="space-y-3 border-t border-amber-200 pt-3">
                    <Button
                      size="lg"
                      variant="destructive"
                      className="w-full"
                      onClick={handleApprove}
                      disabled={saving}
                    >
                      <Icon name={saving ? 'Loader2' : 'Check'} size={18} className={`mr-2 ${saving ? 'animate-spin' : ''}`} />
                      Подтвердить и списать ненайденное ({pending.report?.missingCount ?? 0})
                    </Button>
                    <div className="space-y-2">
                      <Textarea
                        placeholder="Причина возврата на пересчёт (если что-то не сходится)"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        rows={2}
                      />
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={handleReject}
                        disabled={saving || !rejectReason.trim()}
                      >
                        <Icon name="Undo2" size={16} className="mr-1.5" />
                        Вернуть кладовщику на пересчёт
                      </Button>
                      <Button
                        variant="ghost"
                        className="w-full text-muted-foreground"
                        onClick={() => handleCancel(pending.id)}
                        disabled={saving}
                      >
                        <Icon name="Trash2" size={15} className="mr-1.5" />
                        Отменить инвентаризацию — ничего не списывать
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="border-t border-amber-200 pt-3 text-sm text-muted-foreground">
                    Результат отправлен администратору. Ненайденные вещи будут списаны
                    после его подтверждения
                  </p>
                )}
              </div>
            )}

            {/* ИСТОРИЯ. */}
            <div className="rounded-md border border-border">
              <div className="border-b border-border bg-muted/50 px-4 py-2 text-sm font-semibold">
                История инвентаризаций
              </div>
              {history.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Инвентаризаций пока не было</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>№</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Кладовщик</TableHead>
                      <TableHead>Начата</TableHead>
                      <TableHead className="text-center">Числилось</TableHead>
                      <TableHead className="text-center">Найдено</TableHead>
                      <TableHead className="text-center">Списано</TableHead>
                      <TableHead>Подтвердил</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.id}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              s.status === 'approved'
                                ? 'default'
                                : s.status === 'pending_approval'
                                  ? 'secondary'
                                  : s.status === 'rejected'
                                    ? 'destructive'
                                    : 'outline'
                            }
                          >
                            {STOCKTAKE_STATUS_LABEL[s.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>{s.startedByName || '—'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {s.startedAt ? formatDateTime(s.startedAt) : '—'}
                        </TableCell>
                        <TableCell className="text-center">{s.expectedCount}</TableCell>
                        <TableCell className="text-center">{s.foundCount}</TableCell>
                        <TableCell className="text-center font-medium">
                          {s.status === 'approved' ? s.missingCount : '—'}
                        </TableCell>
                        <TableCell>{s.approvedByName || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default Stocktakes;
