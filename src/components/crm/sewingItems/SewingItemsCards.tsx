import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';
import { marketplaceLogo, formatDate, timeAgo, shortFio } from '@/components/crm/sewingItems/sewingItemsShared';

interface SewingItemsCardsProps {
  loading: boolean;
  pagedOrders: Order[];
  onOpenDetail: (order: Order) => void;
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  totalPages: number;
  totalCount: number;
}

const statusBadgeClass: Record<string, string> = {
  Новый: 'bg-slate-500 text-white hover:bg-slate-500',
  'На раскрое': 'bg-amber-500 text-white hover:bg-amber-500',
  'В работе': 'bg-sky-500 text-white hover:bg-sky-500',
  Раскроено: 'bg-violet-500 text-white hover:bg-violet-500',
  Стикеровка: 'bg-orange-500 text-white hover:bg-orange-500',
  Готовые: 'bg-emerald-600 text-white hover:bg-emerald-600',
};

const ribbonClass: Record<string, string> = {
  OZON: 'bg-[#005BFF]',
  WB: 'bg-[#CB11AB]',
  Yandex: 'bg-[#FFCC00]',
};

const SewingItemsCards = ({
  loading,
  pagedOrders,
  onOpenDetail,
  page,
  setPage,
  totalPages,
  totalCount,
}: SewingItemsCardsProps) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (pagedOrders.length === 0) {
    return <p className="text-sm text-muted-foreground">Заказов не найдено.</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Всего заказов: {totalCount}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pagedOrders.map((o) => (
          <Card
            key={o.id}
            className="relative overflow-hidden border-border shadow-none"
          >
            <div
              className={`pointer-events-none absolute -right-11 top-4 w-40 rotate-45 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-white ${ribbonClass[o.marketplace] || 'bg-muted-foreground'}`}
            >
              {marketplaceLogo[o.marketplace]?.label || o.marketplace}
            </div>

            <CardContent className="space-y-2.5 pt-6">
              <p className="pr-6 font-mono-tech text-sm font-semibold">
                {o.orderNumber} {o.orderType}
              </p>

              <Badge className={statusBadgeClass[o.sewingStatus] || ''}>{o.sewingStatus}</Badge>

              <p className="text-xl font-bold leading-tight">
                {o.material || '—'} {o.width && o.height ? `${o.width} x ${o.height}` : ''}
              </p>

              <div className="space-y-1 text-sm text-muted-foreground">
                <p>Создан: {formatDate(o.createdAt)}</p>
                {o.assignedUserName && <p>Сотрудник: {o.assignedUserName}</p>}
                {o.cutterUserName && <p>Кроил: {shortFio(o.cutterUserName)}</p>}
                {o.cutterUserName && <p>Вешалка: № {o.hangerNumber}</p>}
              </div>

              <Badge variant="secondary" className="bg-emerald-100 font-normal text-emerald-700 hover:bg-emerald-100">
                {timeAgo(o.createdAt)}
              </Badge>

              <Button
                className="w-full bg-blue-600 text-white hover:bg-blue-700"
                onClick={() => onOpenDetail(o)}
              >
                <Icon name="Eye" size={16} className="mr-1.5" />
                Просмотр
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            size="icon"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <Icon name="ChevronLeft" size={16} />
          </Button>
          <span className="px-3 text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            size="icon"
            variant="outline"
            disabled={page === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <Icon name="ChevronRight" size={16} />
          </Button>
        </div>
      )}
    </div>
  );
};

export default SewingItemsCards;