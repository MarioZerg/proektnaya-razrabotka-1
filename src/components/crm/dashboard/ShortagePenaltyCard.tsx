import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  fetchPendingPenalties,
  chargePenalty,
  dismissPenalty,
  type PendingPenalty,
} from '@/lib/rollsApi';

const money = (v: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Закрытые рулоны с недостачей — очередь на решение администратора.
 *
 * Недостача не всегда вина сотрудника: поставщик мог недомотать рулон, ткань могла
 * оказаться бракованной. Поэтому система сама никого не штрафует — она показывает
 * рулон, считает сумму сверх нормы поставщика и ждёт решения. Администратор либо
 * удерживает деньги, либо списывает недостачу на поставщика.
 *
 * На панели карточка держит только ИТОГ: сколько рулонов ждёт решения и на какую
 * сумму. Раньше весь разбор вываливался прямо на главную — по десятку рулонов с
 * расчётом на каждый, и панель уезжала на несколько экранов вниз ради очереди,
 * которую разбирают раз в неделю. Сам список открывается по кнопке.
 */
const ShortagePenaltyCard = () => {
  const { toast } = useToast();
  const [items, setItems] = useState<PendingPenalty[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = () => {
    setLoading(true);
    fetchPendingPenalties()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleCharge = async (item: PendingPenalty) => {
    setBusyId(item.rollId);
    try {
      await chargePenalty(item.rollId);
      toast({
        title: 'Штраф начислен',
        description:
          item.users.length === 1
            ? `Рулон ${item.barcode}: ${money(item.total)} ₽ удержано с ${item.users[0].name}`
            : `Рулон ${item.barcode}: ${money(item.total)} ₽ поделено между ${item.users.length} — по ${money(item.perUser || 0)} ₽`,
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось начислить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDismiss = async (item: PendingPenalty) => {
    setBusyId(item.rollId);
    try {
      await dismissPenalty(item.rollId);
      toast({ title: 'Недостача списана на поставщика' });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось выполнить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  // Сколько денег в очереди: сумма по рулонам, где штраф реально можно начислить.
  const totalMoney = items.reduce((sum, i) => sum + (i.reason ? 0 : i.total || 0), 0);

  // Рулоны без штрафа: недостача уложилась в норму поставщика или нет данных для
  // расчёта. Решение по ним всё равно нужно — иначе они висят в очереди вечно.
  const noPenaltyItems = items.filter((i) => !!i.reason);
  const penaltyItems = items.filter((i) => !i.reason);

  // Штрафные — наверх: с ними работают, остальные просто закрывают пачкой.
  const sortedItems = [...items].sort((a, b) => (b.reason ? 0 : b.total) - (a.reason ? 0 : a.total));

  const handleDismissAllClean = async () => {
    setBulkBusy(true);
    try {
      // По одному запросу на рулон: отдельного массового действия на сервере нет,
      // а очередь тут небольшая — десятки записей, не тысячи.
      for (const item of noPenaltyItems) {
        await dismissPenalty(item.rollId);
      }
      toast({
        title: 'Убрано из очереди',
        description: `${noPenaltyItems.length} шт. — недостача в пределах нормы`,
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось убрать все',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
      load();
    } finally {
      setBulkBusy(false);
    }
  };

  if (!loading && items.length === 0) return null;

  return (
    <>
      <Card className="border-border shadow-none">
        <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700">
            <Icon name="TriangleAlert" size={20} />
          </span>

          <div className="min-w-[180px] flex-1">
            <p className="text-sm font-semibold">Недостача в закрытых рулонах</p>
            {loading ? (
              <p className="text-xs text-muted-foreground">Загружаем очередь…</p>
            ) : (
              /* Итог одной строкой: сколько рулонов реально стоят денег, сколько
                 просто ждут отметки, и на какую сумму идёт речь. */
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Ждут решения: <b className="text-foreground">{items.length}</b>
                </span>
                {penaltyItems.length > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      со штрафом <b className="text-foreground">{penaltyItems.length}</b> на{' '}
                      <b className="text-foreground">{money(totalMoney)} ₽</b>
                    </span>
                  </>
                )}
                {noPenaltyItems.length > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span>в пределах нормы {noPenaltyItems.length}</span>
                  </>
                )}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Рулоны, где штрафовать не за что, убираем пачкой прямо отсюда:
                ради этого открывать список не нужно. */}
            {noPenaltyItems.length > 0 && (
              <Button size="sm" variant="ghost" onClick={handleDismissAllClean} disabled={bulkBusy}>
                <Icon
                  name={bulkBusy ? 'Loader2' : 'ListChecks'}
                  size={14}
                  className={`mr-1.5 ${bulkBusy ? 'animate-spin' : ''}`}
                />
                Убрать {noPenaltyItems.length} без штрафа
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={loading}>
              Разобрать
              <Icon name="ChevronRight" size={14} className="ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Разбор — в отдельном окне: он длинный, но нужен раз в неделю. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3 sm:px-5">
            <DialogTitle className="flex items-center gap-2 text-base">
              Недостача в закрытых рулонах
              <Badge variant="secondary">{items.length}</Badge>
            </DialogTitle>
            <DialogDescription className="text-xs">
              {totalMoney > 0
                ? `Сверх нормы поставщика — на ${money(totalMoney)} ₽`
                : 'Штрафовать не за что: всё в пределах нормы'}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4 sm:p-5">
            {items.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Очередь разобрана — нерассмотренных рулонов нет
              </p>
            )}
            {sortedItems.map((item) => (
              <div key={item.rollId} className="space-y-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {item.materialName}{' '}
                      <span className="font-mono-tech text-xs text-muted-foreground">
                        #{item.barcode}
                      </span>
                    </p>
                    {/* Весь расчёт в одну строку: было — не ушло в изделия — норма.
                        Администратор удерживает деньги у людей и должен видеть, из
                        чего сложилась сумма, не открывая карточку рулона. */}
                    <p className="text-xs text-muted-foreground">
                      В рулоне было {item.initialQuantity} {item.unit} · в изделия не ушло{' '}
                      <b className="text-foreground">
                        {item.shortage} {item.unit}
                      </b>
                      {item.normPercent != null && (
                        <>
                          {' '}
                          · норма {item.normPercent}% = {item.allowed} {item.unit}
                        </>
                      )}
                    </p>
                    {/* Кто закрыл рулон — и что сама написала в графе недостачи.
                        Расхождение с фактом здесь самое важное: рулон закрывали
                        с «недостачей 0.5», когда на нём висело 15 метров. */}
                    {item.closedByName && (
                      <p className="text-xs text-muted-foreground">
                        Закрыла: {item.closedByName}
                        {item.declaredShortage != null && (
                          <>
                            {' '}
                            · заявила недостачу {item.declaredShortage} {item.unit}
                          </>
                        )}
                      </p>
                    )}
                  </div>
                  {item.total > 0 && (
                    <p className="shrink-0 text-lg font-bold">{money(item.total)} ₽</p>
                  )}
                </div>

                {/* Причина, по которой штраф начислить нельзя — норма не задана и т.п. */}
                {item.reason ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">{item.reason}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDismiss(item)}
                      disabled={busyId === item.rollId}
                    >
                      Убрать из списка
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Сверх нормы {item.excess} {item.unit} × {money(item.costPerUnit)} ₽
                    </p>
                    {/* Поимённо, с суммой на каждого: администратор удерживает деньги
                        у живых людей и должен видеть, у кого именно и сколько, до
                        нажатия кнопки, а не после.
                        Формулировка зависит от числа причастных: «по X ₽ с каждой»
                        при одном человеке читалось так, будто сумма умножается. */}
                    <div className="rounded-md bg-muted/40 p-2">
                      <p className="mb-1 text-xs font-medium">
                        {item.users.length === 1
                          ? `${item.role}: работала одна — вся сумма ${money(item.total)} ₽ на неё`
                          : `${item.role}: работали ${item.users.length} — сумма делится поровну, по ${money(item.perUser || 0)} ₽`}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {item.users.map((u) => (
                          <Badge key={u.id} variant="outline" className="font-normal">
                            {u.name}
                            {u.usedQuantity != null && u.usedQuantity > 0 && (
                              <span className="ml-1 text-muted-foreground">
                                · отшила {u.usedQuantity} {item.unit}
                              </span>
                            )}
                            <span className="ml-1 font-medium text-destructive">
                              −{money(u.amount)} ₽
                            </span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleCharge(item)}
                        disabled={busyId === item.rollId}
                      >
                        {busyId === item.rollId ? (
                          <Icon name="Loader2" size={14} className="mr-1 animate-spin" />
                        ) : (
                          <Icon name="Wallet" size={14} className="mr-1" />
                        )}
                        Начислить штраф
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDismiss(item)}
                        disabled={busyId === item.rollId}
                      >
                        Вина поставщика
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ShortagePenaltyCard;
