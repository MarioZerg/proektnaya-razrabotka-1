import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/ui/icon';
import { Badge } from '@/components/ui/badge';
import {
  fetchReturnHistory,
  type GoodsCard as GoodsCardType,
  type ReturnHistoryEntry,
} from '@/lib/goodsWarehouseApi';
import { lifeFromCard } from '@/lib/goodsLifeTimeline';
import GoodsLifeTimeline from '@/components/crm/goodsWarehouse/GoodsLifeTimeline';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';

/**
 * Жизнь вещи на карточке: когда отгрузили, вернули, оформили снова, забрали.
 *
 * Возвраты приезжают вместе с карточкой. Если облачная функция ещё старая и
 * поля нет — добираем отдельным запросом, чтобы таймлайн не ждал деплоя.
 */
const GoodsCardLife = ({ card }: { card: GoodsCardType }) => {
  const embedded = card.returns;
  const [fetched, setFetched] = useState<ReturnHistoryEntry[] | null>(null);
  const [historyLost, setHistoryLost] = useState(!!card.historyLost);
  const [listError, setListError] = useState<string | null>(null);

  const load = () => {
    if (embedded) return;
    fetchReturnHistory(card.id)
      .then((d) => {
        setListError(null);
        setFetched(d.history || []);
        setHistoryLost(!!d.historyLost);
      })
      .catch((e) => {
        setListError(e instanceof Error ? e.message : 'Не удалось загрузить историю возвратов');
      });
  };

  useEffect(() => {
    setHistoryLost(!!card.historyLost);
    if (embedded) {
      setFetched(null);
      setListError(null);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, embedded]);

  const returns = embedded || fetched || [];
  const events = useMemo(
    () => lifeFromCard({ ...card, returns }),
    [card, returns],
  );
  const returnCount = returns.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">История вещи</h2>
        {returnCount > 0 && (
          <Badge variant={returnCount >= 3 ? 'destructive' : 'secondary'}>
            возвратов: {returnCount}
          </Badge>
        )}
      </div>

      {listError && (
        <WarehouseFetchError
          title="Не удалось загрузить историю возвратов"
          description={listError}
          onRetry={load}
        />
      )}

      {historyLost && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 p-3">
          <Icon name="TriangleAlert" size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            История потеряна — вещь добавлена вручную. Сколько раз её возвращали
            раньше, система не знает: осмотрите перед отправкой покупателю
          </p>
        </div>
      )}

      {returnCount >= 3 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
          <Icon name="TriangleAlert" size={16} className="mt-0.5 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">
            Вещь возвращали {returnCount} раза — скорее всего с ней что-то не так.
            Осмотрите её, прежде чем отправлять снова
          </p>
        </div>
      )}

      <GoodsLifeTimeline events={events} />
    </div>
  );
};

export default GoodsCardLife;
