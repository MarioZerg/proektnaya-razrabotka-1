import { useEffect, useState } from 'react';
import Icon from '@/components/ui/icon';
import { Badge } from '@/components/ui/badge';
import {
  fetchReturnHistory,
  type ReturnHistoryEntry,
} from '@/lib/goodsWarehouseApi';
import { formatDate } from './formatDate';

/**
 * История возвратов вещи: сколько раз её возвращали и кому она принадлежала.
 *
 * Кладовщику это нужно для одного решения — осмотреть вещь или сразу класть на
 * полку. Покупатели не возвращают исправный товар снова и снова: вещь, приехавшая
 * обратно в третий раз, почти наверняка с изъяном. Раньше такой информации не было
 * вовсе, и каждый возврат выглядел первым.
 *
 * Отдельно помечаем вещи, заведённые вручную: их прошлый путь системе неизвестен.
 * Показать по ним «возвратов: 0» было бы неправдой — это не «новая вещь», а
 * «мы не знаем», и осмотреть такую вещь тоже стоит.
 */
const outcomeLabel: Record<string, string> = {
  stored: 'положили на полку',
  repack: 'перепаковали',
  utilized: 'утилизировали',
};

const GoodsReturnHistory = ({ goodsId }: { goodsId: number }) => {
  const [history, setHistory] = useState<ReturnHistoryEntry[]>([]);
  const [historyLost, setHistoryLost] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReturnHistory(goodsId)
      .then((d) => {
        setHistory(d.history || []);
        setHistoryLost(!!d.historyLost);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [goodsId]);

  if (loading) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Возвраты этой вещи</h2>
        {history.length > 0 && (
          <Badge variant={history.length >= 3 ? 'destructive' : 'secondary'}>
            {history.length}
          </Badge>
        )}
      </div>

      {historyLost && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 p-3">
          <Icon name="TriangleAlert" size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            История потеряна — вещь добавлена вручную. Сколько раз её возвращали
            раньше, система не знает: осмотрите перед отправкой покупателю
          </p>
        </div>
      )}

      {history.length >= 3 && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
          <Icon name="TriangleAlert" size={16} className="mt-0.5 shrink-0 text-destructive" />
          <p className="text-sm text-destructive">
            Вещь возвращали {history.length} раза — скорее всего с ней что-то не так.
            Осмотрите её, прежде чем отправлять снова
          </p>
        </div>
      )}

      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {historyLost
            ? 'После добавления на склад возвратов не было'
            : 'Эту вещь ни разу не возвращали'}
        </p>
      ) : (
        <div className="space-y-2">
          {history.map((h) => (
            <div
              key={h.returnNumber}
              className="flex items-start gap-3 rounded-md border border-border p-3"
            >
              <Icon name="Undo2" size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  Возврат №{h.returnNumber}
                  {h.marketplace ? ` · ${h.marketplace}` : ''}
                  {h.outcome ? ` · ${outcomeLabel[h.outcome] || h.outcome}` : ''}
                </p>
                {h.returnReason && (
                  <p className="text-sm text-muted-foreground">{h.returnReason}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {/* Кому вещь принадлежала — заказ, по которому она уезжала. */}
                  {h.orderNumber || h.postingNumber || 'заказ неизвестен'}
                  {h.returnedAt ? ` · ${formatDate(h.returnedAt)}` : ''}
                  {h.receivedByName ? ` · принял ${h.receivedByName}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default GoodsReturnHistory;
