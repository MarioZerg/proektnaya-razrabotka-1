import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
 */
const ShortagePenaltyCard = () => {
  const { toast } = useToast();
  const [items, setItems] = useState<PendingPenalty[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

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
        description: `Рулон ${item.barcode}: ${money(item.total)} ₽ — удержано с ${item.users.length} чел.`,
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
    <Card className="border-border shadow-none">
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon name="TriangleAlert" size={18} className="text-muted-foreground" />
            <p className="font-medium">Недостача в закрытых рулонах</p>
            {items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
          </div>
          {/* Итог по очереди: сколько денег на кону, если удержать всё сверх нормы. */}
          {totalMoney > 0 && (
            <p className="text-sm text-muted-foreground">
              Сверх нормы на <b className="text-foreground">{money(totalMoney)} ₽</b>
            </p>
          )}
        </div>

        {/* Рулоны, где штрафовать не за что (недостача в пределах нормы, нет цены),
            убираем пачкой. Иначе очередь копится по 10–20 штук в день, и разбирать
            её по одной кнопке физически некогда — именно так она и разрослась
            до двух тысяч записей в прошлый раз. */}
        {noPenaltyItems.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={handleDismissAllClean}
            disabled={bulkBusy}
          >
            {bulkBusy ? (
              <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Icon name="ListChecks" size={14} className="mr-1.5" />
            )}
            Убрать без штрафа: {noPenaltyItems.length} шт. в пределах нормы
          </Button>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка…
          </div>
        ) : (
          <div className="space-y-2">
            {sortedItems.map((item) => (
              <div
                key={item.rollId}
                className="space-y-2 rounded-md border border-border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {item.materialName}{' '}
                      <span className="font-mono-tech text-sm text-muted-foreground">
                        #{item.barcode}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      В рулоне было {item.initialQuantity} {item.unit} · не хватило{' '}
                      <b>
                        {item.shortage} {item.unit}
                      </b>
                      {item.normPercent != null && (
                        <> · норма {item.normPercent}% ({item.allowed} {item.unit})</>
                      )}
                    </p>
                    {/* Кто закрыл рулон и сколько на нём числилось в тот момент —
                        по этим двум цифрам недостачу можно перепроверить. */}
                    {item.closedByName && (
                      <p className="text-xs text-muted-foreground">
                        Закрыла: {item.closedByName}
                        {item.remainingAtClose != null && (
                          <> · на рулоне числилось {item.remainingAtClose} {item.unit}</>
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
                  <p className="text-sm text-muted-foreground">{item.reason}</p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Сверх нормы {item.excess} {item.unit} × {money(item.costPerUnit)} ₽
                    </p>
                    {/* Поимённо, с суммой на каждого: администратор удерживает деньги
                        у живых людей и должен видеть, у кого именно и сколько, до
                        нажатия кнопки, а не после. */}
                    <div className="rounded-md bg-muted/40 p-2">
                      <p className="mb-1 text-xs font-medium">
                        {item.role} — по {money(item.perUser || 0)} ₽ с каждой:
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {item.users.map((u) => (
                          <Badge key={u.id} variant="outline" className="font-normal">
                            {u.name}
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

                {item.reason && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDismiss(item)}
                    disabled={busyId === item.rollId}
                  >
                    Убрать из списка
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ShortagePenaltyCard;