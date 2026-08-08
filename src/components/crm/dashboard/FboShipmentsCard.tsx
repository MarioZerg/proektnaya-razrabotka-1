import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import {
  fetchFboBoard,
  confirmGazelkaShip,
  type FboBoardItem,
} from '@/lib/marketplaceSuppliesApi';

const fmtDateTime = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const statusVariant = (status: string): 'secondary' | 'default' | 'outline' => {
  if (status === 'Отгрузка') return 'default';
  if (status === 'На сборке') return 'secondary';
  return 'outline';
};

/**
 * Отгрузки FBO на дашборде.
 *
 * Поставка проходит путь: сборка → уезжает в газельку → сдаётся на воротах маркетплейса.
 * Здесь этот путь виден целиком, чтобы не открывать каждую поставку по отдельности.
 *
 * Отдельно решается частая проблема: машина уехала, а кладовщик забыл отметить отгрузку —
 * поставка продолжает висеть на сборке. Если плановое время отгрузки прошло, а отметки
 * нет, система прямо спрашивает: «Поставка уехала в газельку?».
 */
const FboShipmentsCard = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<FboBoardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    fetchFboBoard()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const answer = async (item: FboBoardItem, shipped: boolean) => {
    setBusyId(item.id);
    try {
      await confirmGazelkaShip(item.id, shipped);
      toast({
        title: shipped ? 'Отгрузка отмечена' : 'Напоминание перенесено на завтра',
      });
      load();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  if (!loading && items.length === 0) return null;

  const pending = items.filter((i) => i.needsShipConfirm);

  return (
    <Card className="border-border shadow-none">
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center gap-2">
          <Icon name="Truck" size={18} className="text-muted-foreground" />
          <p className="font-medium">Отгрузки FBO</p>
          {items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка…
          </div>
        ) : (
          <>
            {/* Поставки, по которым время отгрузки прошло, а отметки нет: спрашиваем
                у кладовщика напрямую, иначе поставка так и зависнет на сборке. */}
            {pending.map((item) => (
              <div
                key={item.id}
                className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900"
              >
                <div className="flex items-start gap-2">
                  <Icon name="TriangleAlert" size={20} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-bold">
                      Поставка {item.supplyNumber || `#${item.id}`} уехала в газельку?
                    </p>
                    <p className="text-sm">
                      Отгрузка была назначена на {fmtDateTime(item.shipToGazelkaAt)}, но
                      отметки нет — поставка числится в статусе «{item.status}»
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => answer(item, true)}
                    disabled={busyId === item.id}
                  >
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

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="text-primary-foreground">Поставка</TableHead>
                    <TableHead className="text-primary-foreground">Маркетплейс</TableHead>
                    <TableHead className="text-primary-foreground">Кластер</TableHead>
                    <TableHead className="text-primary-foreground text-right">Заказов</TableHead>
                    <TableHead className="text-primary-foreground">Статус</TableHead>
                    <TableHead className="text-primary-foreground">В газельку</TableHead>
                    <TableHead className="text-primary-foreground">Способ</TableHead>
                    <TableHead className="text-primary-foreground">На воротах</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/crm/shipments/to-marketplace/${item.id}`)}
                    >
                      <TableCell className="font-mono-tech font-medium">
                        {item.supplyNumber || `#${item.id}`}
                      </TableCell>
                      <TableCell>{item.marketplace}</TableCell>
                      <TableCell>{item.cluster || '—'}</TableCell>
                      <TableCell className="text-right">{item.ordersCount}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(item.status)}>{item.status}</Badge>
                      </TableCell>
                      {/* Показываем факт отгрузки, если он есть, иначе план. */}
                      <TableCell className="text-sm">
                        {item.gazelkaShippedAt ? (
                          <span className="font-medium">
                            {fmtDateTime(item.gazelkaShippedAt)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            план {fmtDateTime(item.shipToGazelkaAt)}
                          </span>
                        )}
                      </TableCell>
                      {/* Забирает газелька с нашего склада или везём до склада сами. */}
                      <TableCell className="text-sm text-muted-foreground">
                        {item.gazelkaPickup ? 'Забор газелькой' : 'До склада'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {fmtDateTime(item.shipToMarketplaceAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default FboShipmentsCard;
