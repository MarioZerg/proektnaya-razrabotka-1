import Icon from '@/components/ui/icon';
import type { GoodsCard as GoodsCardType } from '@/lib/goodsWarehouseApi';
import { formatDate } from './formatDate';

/** История движения: кто из сотрудников что делал с этой вещью. */
const GoodsCardHistory = ({ history }: { history: GoodsCardType['history'] }) => (
  <div className="space-y-2">
    <h2 className="font-semibold">История движения</h2>
    {history.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        История пока пустая — по этой вещи ещё не было событий
      </p>
    ) : (
      <div className="space-y-2">
        {history.map((h, idx) => (
          <div
            key={idx}
            className="flex items-start gap-3 rounded-md border border-border p-3"
          >
            <Icon name="History" size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm">{h.description || h.action}</p>
              <p className="text-xs text-muted-foreground">
                {h.userName || 'Система'} · {formatDate(h.createdAt)}
              </p>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

export default GoodsCardHistory;
