import { useEffect, useState } from 'react';
import { useIdSubmitGuard } from '@/hooks/useSubmitGuard';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { usePolling } from '@/hooks/usePolling';
import {
  fetchFboBoard,
  fetchSupplies,
  confirmGazelkaShip,
  type FboBoardItem,
  type Supply,
} from '@/lib/marketplaceSuppliesApi';
import { fetchGazelkaPlans } from '@/lib/gazelkaApi';
import ToMarketplaceCards from '@/components/crm/marketplaceSupplies/ToMarketplaceCards';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
};

/** Обновляем сами: кладовщик меняет поставку в соседней вкладке, а дашборд висит открытым. */
const REFRESH_MS = 30_000;

/**
 * Отгрузки FBO на дашборде — теми же строками, что во вкладке «Поставки в маркетплейс»:
 * газелька, машина, обратный отсчёт, штуки в коробах. Один вид в двух местах,
 * чтобы человек не сверял две разные раскладки одной и той же поставки.
 *
 * Отдельно — вопрос «уехала в газельку?», если время отгрузки прошло, а отметки нет.
 */
const FboShipmentsCard = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [pending, setPending] = useState<FboBoardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const { busyId, run } = useIdSubmitGuard();

  const load = async () => {
    try {
      const [list, board, plans] = await Promise.all([
        fetchSupplies({ type: 'FBO' }),
        fetchFboBoard(),
        fetchGazelkaPlans().catch(() => []),
      ]);
      // Номер машины живёт в заявке Газельки, а не в поставке: подставляем его
      // при каждом обновлении — водителя назначают уже после создания поставки.
      const plateByPlan = new Map(plans.map((p) => [p.id, p.vehicleNumber || null]));
      setSupplies(
        list
          .filter((s) => s.status !== 'Выполнена')
          .map((s) => ({
            ...s,
            gazelkaVehicleNumber:
              (s.gazelkaPlanId != null ? plateByPlan.get(s.gazelkaPlanId) : null) ||
              s.gazelkaVehicleNumber,
          })),
      );
      setPending(board.filter((i) => i.needsShipConfirm));
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Не удалось загрузить отгрузки FBO');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);
  usePolling(load, REFRESH_MS);

  const answer = (item: FboBoardItem, shipped: boolean) => {
    void run(item.id, async () => {
      setPending((prev) => prev.filter((i) => i.id !== item.id));
      try {
        await confirmGazelkaShip(item.id, shipped);
        toast({ title: shipped ? 'Отгрузка отмечена' : 'Напоминание перенесено на завтра' });
        void load();
      } catch (e) {
        setPending((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item]));
        toast({
          title: 'Не удалось сохранить',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      }
    });
  };

  if (!loading && supplies.length === 0 && pending.length === 0 && !listError) return null;

  if (listError && supplies.length === 0) {
    return (
      <WarehouseFetchError
        title="Не удалось загрузить отгрузки FBO"
        description={listError}
        onRetry={() => void load()}
      />
    );
  }

  return (
    <Card className="border-border shadow-none">
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center gap-2">
          <Icon name="Truck" size={18} className="text-muted-foreground" />
          <p className="font-medium">Отгрузки FBO</p>
          {supplies.length > 0 && <Badge variant="secondary">{supplies.length}</Badge>}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка…
          </div>
        ) : (
          <>
            {pending.map((item) => (
              <div
                key={item.id}
                className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"
              >
                <div className="flex items-start gap-2">
                  <Icon name="TriangleAlert" size={20} className="mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-bold leading-snug">
                      Поставка {item.supplyNumber || `#${item.id}`} уехала в газельку?
                    </p>
                    <p className="text-sm leading-snug">
                      Отгрузка была назначена на {fmtDateTime(item.shipToGazelkaAt)}, но
                      отметки нет — поставка числится в статусе «{item.status}»
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => answer(item, true)} disabled={busyId === item.id}>
                    {busyId === item.id ? (
                      <Icon name="Loader2" size={14} className="mr-1 animate-spin" />
                    ) : (
                      <Icon name="Check" size={14} className="mr-1" />
                    )}
                    Да, уехала
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => answer(item, false)}
                    disabled={busyId === item.id}
                  >
                    Нет, ещё на складе
                  </Button>
                </div>
              </div>
            ))}

            <ToMarketplaceCards
              supplies={supplies}
              onOpen={(id) => navigate(`/crm/shipments/to-marketplace/${id}`)}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default FboShipmentsCard;
