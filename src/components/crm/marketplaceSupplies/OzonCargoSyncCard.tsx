import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { syncOzonCargoes } from '@/lib/ozonFboApi';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';

interface OzonCargoSyncCardProps {
  supply: SupplyDetail;
  /** Перечитать поставку после сверки. */
  onSynced: () => void;
}

/**
 * Сверка грузомест с OZON — лечит «лишние короба» на площадке.
 *
 * ЗАЧЕМ. На OZON копятся грузоместа-сироты: короб удалили у нас, а место
 * осталось висеть с полным товарным составом. Заявка ждёт больше коробов,
 * чем реально приедет, и на приёмке всплывает одинаковый товар под разными
 * штрихкодами.
 *
 * Причины закрыты в коде, но уже накопленный мусор надо чем-то убрать —
 * этим и занимается кнопка. Она ничего не создаёт: только сверяет список
 * мест на площадке с нашими коробами и снимает лишнее.
 */
const OzonCargoSyncCard = ({ supply, onSynced }: OzonCargoSyncCardProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  // Сверять есть с чем, только когда хотя бы один короб уехал на OZON.
  const closedOnOzon = supply.boxes.filter((b) => b.ozonCargoId).length;
  if (closedOnOzon === 0) return null;

  const handleSync = async () => {
    setBusy(true);
    try {
      const r = await syncOzonCargoes(supply.id, { id: user?.id, name: user?.name });
      if (!r.done) {
        toast({ title: 'OZON ещё обрабатывает запрос', description: r.note });
        return;
      }
      toast({
        title: r.removed ? `Снято лишних коробов: ${r.removed}` : 'Всё сходится',
        description: r.note,
      });
      onSynced();
    } catch (e) {
      toast({
        title: 'Не удалось сверить с OZON',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-border shadow-none">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            <Icon name="ShieldCheck" size={16} className="text-[#005BFF]" />
            Сверка коробов с OZON
          </p>
          <p className="text-sm text-muted-foreground">
            Проверит, не осталось ли на площадке лишних коробов от удалённых или
            переоткрытых — и уберёт их. У нас закрыто и заведено: {closedOnOzon}
          </p>
        </div>
        <Button variant="outline" onClick={handleSync} disabled={busy}>
          <Icon
            name={busy ? 'Loader2' : 'RefreshCw'}
            size={16}
            className={`mr-1.5 ${busy ? 'animate-spin' : ''}`}
          />
          {busy ? 'Сверяем…' : 'Проверить OZON'}
        </Button>
      </CardContent>
    </Card>
  );
};

export default OzonCargoSyncCard;
