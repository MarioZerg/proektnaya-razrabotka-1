import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import { useToast } from '@/hooks/use-toast';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
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
 *
 * POEHALI: start/close/scan/approve — функция stocktakes, не дублировать.
 * FRONTEND-ONLY: ошибка загрузки не должна выглядеть как «пересчёт не идёт».
 */
const Stocktakes = () => {
  const navigate = useNavigate();
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
  const [listError, setListError] = useState<string | null>(null);
  const { busy: saving, run } = useSubmitGuard();
  const [note, setNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [act, list] = await Promise.all([fetchActiveStocktake(), fetchStocktakes()]);
      setListError(null);
      setActive(act);
      setHistory(list);
      // Инвентаризация, ждущая решения админа: показываем её отдельным блоком
      // с полным отчётом — админ должен видеть, что именно он подтверждает.
      const waiting = list.find((s) => s.status === 'pending_approval');
      setPending(waiting ? await fetchStocktake(waiting.id) : null);
    } catch (e) {
      setListError(
        e instanceof Error ? e.message : 'Не удалось загрузить инвентаризацию',
      );
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

  const handleStart = () => {
    void run(async () => {
      try {
        await startStocktake(user?.id, user?.name);
        toast({ title: 'Инвентаризация начата', description: 'Сканируйте стикеры GW с полок' });
        await load();
      } catch (e) {
        toast({
          title: 'Не удалось начать',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    });
  };

  const handleClose = () => {
    if (!active) return;
    void run(async () => {
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
        await load();
      } catch (e) {
        toast({
          title: 'Не удалось закрыть',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    });
  };

  const handleApprove = () => {
    if (!pending) return;
    void run(async () => {
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
        await load();
      } catch (e) {
        toast({
          title: 'Не удалось подтвердить',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    });
  };

  const handleCancel = (id: number) => {
    void run(async () => {
      try {
        await cancelStocktake(id, undefined, user?.id, user?.name);
        toast({
          title: 'Инвентаризация отменена',
          description: 'Товар не затронут — ничего не списано',
        });
        await load();
      } catch (e) {
        toast({
          title: 'Не удалось отменить',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    });
  };

  const handleReject = () => {
    if (!pending || !rejectReason.trim()) return;
    void run(async () => {
      try {
        await rejectStocktake(pending.id, rejectReason.trim(), user?.id, user?.name);
        toast({ title: 'Возвращено на пересчёт' });
        setRejectReason('');
        await load();
      } catch (e) {
        toast({
          title: 'Не удалось вернуть',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    });
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        {/* Возврат на склад товара: инвентаризация открывается плашкой оттуда, и
            уйти обратно было нечем — в меню строки нет. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/crm/inventory/goods-warehouse')}
          className="-ml-2 -mb-2"
        >
          <Icon name="ChevronLeft" size={16} className="mr-1" />
          К складу товара
        </Button>

        <div>
          <h1 className="text-xl font-bold">Инвентаризация склада</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Пересчёт товара по полкам складскими стикерами GW. Ненайденные вещи списывает
            администратор после подтверждения
          </p>
        </div>

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить инвентаризацию"
            description={listError}
            onRetry={load}
          />
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            {/* ИДЁТ ПЕРЕСЧЁТ — рабочий экран: сканер, цифры, кнопки. Без истории. */}
            {active && canCount && (
              <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>№{active.id}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {active.startedByName || '—'}
                      {active.startedAt ? ` · ${formatDateTime(active.startedAt)}` : ''}
                    </span>
                  </div>
                </div>

                {active.status === 'rejected' && active.rejectReason && (
                  <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Вернули на пересчёт: {active.rejectReason}
                  </div>
                )}

                <StocktakeScanner stocktake={active} onScanned={reloadActive} />

                {active.report && <StocktakeReportView report={active.report} compact />}

                <Textarea
                  placeholder="Комментарий админу (необязательно)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={1}
                  className="min-h-9 resize-none"
                />
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Button className="sm:flex-1" onClick={handleClose} disabled={saving}>
                    <Icon
                      name={saving ? 'Loader2' : 'Send'}
                      size={16}
                      className={`mr-1.5 ${saving ? 'animate-spin' : ''}`}
                    />
                    Закрыть и отправить админу
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-muted-foreground sm:shrink-0"
                    onClick={() => handleCancel(active.id)}
                    disabled={saving}
                  >
                    <Icon name="Trash2" size={15} className="mr-1.5" />
                    Отменить
                  </Button>
                </div>
              </div>
            )}

            {!active && canCount && !listError && (
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
                  <div className="space-y-2 border-t border-amber-200 pt-3">
                    <Button
                      variant="destructive"
                      className="w-full"
                      onClick={handleApprove}
                      disabled={saving}
                    >
                      <Icon
                        name={saving ? 'Loader2' : 'Check'}
                        size={16}
                        className={`mr-1.5 ${saving ? 'animate-spin' : ''}`}
                      />
                      Подтвердить и списать ({pending.report?.missingCount ?? 0})
                    </Button>
                    <Textarea
                      placeholder="Причина возврата на пересчёт"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={1}
                      className="min-h-9 resize-none"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        variant="outline"
                        className="sm:flex-1"
                        onClick={handleReject}
                        disabled={saving || !rejectReason.trim()}
                      >
                        <Icon name="Undo2" size={16} className="mr-1.5" />
                        Вернуть на пересчёт
                      </Button>
                      <Button
                        variant="ghost"
                        className="text-muted-foreground sm:shrink-0"
                        onClick={() => handleCancel(pending.id)}
                        disabled={saving}
                      >
                        <Icon name="Trash2" size={15} className="mr-1.5" />
                        Отменить без списания
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

            {/* История — только когда пересчёт не идёт: во время работы не отвлекает. */}
            {!active && (
              <div className="rounded-md border border-border">
                <div className="border-b border-border bg-muted/50 px-3 py-1.5 text-sm font-semibold">
                  История
                </div>
                {history.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">Инвентаризаций пока не было</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-8 w-12">№</TableHead>
                        <TableHead className="h-8">Статус</TableHead>
                        <TableHead className="h-8">Кто</TableHead>
                        <TableHead className="h-8">Когда</TableHead>
                        <TableHead className="h-8 text-center">Найдено</TableHead>
                        <TableHead className="h-8 text-center">Списано</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="py-1.5 font-medium">{s.id}</TableCell>
                          <TableCell className="py-1.5">
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
                          <TableCell className="py-1.5">{s.startedByName || '—'}</TableCell>
                          <TableCell className="py-1.5 text-sm text-muted-foreground">
                            {s.startedAt ? formatDateTime(s.startedAt) : '—'}
                          </TableCell>
                          <TableCell className="py-1.5 text-center tabular-nums">
                            {s.foundCount}
                            <span className="text-muted-foreground">/{s.expectedCount}</span>
                          </TableCell>
                          <TableCell className="py-1.5 text-center font-medium tabular-nums">
                            {s.status === 'approved' ? s.missingCount : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default Stocktakes;
