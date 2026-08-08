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

  if (!loading && items.length === 0) return null;

  return (
    <Card className="border-border shadow-none">
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center gap-2">
          <Icon name="TriangleAlert" size={18} className="text-muted-foreground" />
          <p className="font-medium">Недостача в закрытых рулонах</p>
          {items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка…
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
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
                      Сверх нормы {item.excess} {item.unit} × {money(item.costPerUnit)} ₽ ·{' '}
                      {item.role}: {item.users.map((u) => u.name).join(', ')} — по{' '}
                      {money(item.perUser || 0)} ₽ с каждой
                    </p>
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
