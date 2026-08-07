import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';
import { marketplaceLogo, formatDate } from '@/components/crm/sewingItems/sewingItemsShared';
import OrderStagesDiagram from '@/components/crm/sewingItems/OrderStagesDiagram';
import OrderWaitTimer from '@/components/crm/sewingItems/OrderWaitTimer';
import { printFboSticker } from '@/lib/printFboSticker';

interface SewingItemsCardsProps {
  loading: boolean;
  pagedOrders: Order[];
  onOpenDetail: (order: Order) => void;
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  totalPages: number;
  totalCount: number;
  /** Печать стикера FBO доступна только кладовщику и админу. */
  canPrintSticker?: boolean;
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
  canPrintSticker = false,
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {pagedOrders.map((o) => (
          <Card
            key={o.id}
            className="relative cursor-pointer overflow-hidden border-border shadow-none transition-colors hover:bg-muted/40"
            onClick={() => onOpenDetail(o)}
          >
            {/* Цветная полоса слева — маркетплейс заказа, не занимает места в контенте. */}
            <span
              className={`absolute inset-y-0 left-0 w-1 ${ribbonClass[o.marketplace] || 'bg-muted-foreground'}`}
            />

            <CardContent className="space-y-1.5 p-3 pl-4">
              <div className="flex items-start justify-between gap-2">
                {/* Номер заказа переносим целиком (break-all): у OZON он длинный и раньше
                    обрезался многоточием — сотрудник не видел, какой это заказ. */}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span
                      className={marketplaceLogo[o.marketplace]?.className || 'font-bold'}
                    >
                      {marketplaceLogo[o.marketplace]?.label || o.marketplace}
                    </span>
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                      {o.orderType}
                    </Badge>
                    {/* Заказ покупателя из нескольких вещей едет по одному общему ярлыку —
                        предупреждаем, что вещь нельзя отправлять отдельно от остальных. */}
                    {o.groupSize && o.groupSize > 1 && (
                      <Badge className="bg-violet-600 px-1.5 py-0 text-[10px] text-white hover:bg-violet-600">
                        Заказ {o.groupPosition} из {o.groupSize}
                      </Badge>
                    )}
                    {/* Заказ юридического лица (B2B с OZON): такие заказы шьются так же,
                        но цех должен видеть, что покупатель — компания. */}
                    {o.isLegalEntity && (
                      <Badge className="bg-indigo-600 px-1.5 py-0 text-[10px] text-white hover:bg-indigo-600">
                        Юр. лицо
                      </Badge>
                    )}
                  </p>
                  <p className="break-all font-mono-tech text-[11px] text-muted-foreground">
                    {o.orderNumber}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {canPrintSticker && o.orderType === 'FBO' && o.sewingStatus === 'Готовые' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        printFboSticker(o);
                      }}
                      className="text-muted-foreground hover:text-blue-600"
                      aria-label="Печать стикера FBO"
                    >
                      <Icon name="Printer" size={15} />
                    </button>
                  )}
                  <OrderWaitTimer order={o} compact />
                  <Badge className={`${statusBadgeClass[o.sewingStatus] || ''} shrink-0 text-[11px]`}>
                    {o.sewingStatus}
                  </Badge>
                </div>
              </div>

              <p className="truncate text-base font-bold leading-tight">
                {o.material || '—'} {o.width && o.height ? `${o.width} x ${o.height}` : ''}
              </p>

              <p className="truncate text-xs text-muted-foreground">
                {formatDate(o.marketplaceCreatedAt || o.createdAt)}
                {o.assignedUserName ? ` · ${o.assignedUserName}` : ''}
                {o.hangerNumber > 0 ? ` · вешалка № ${o.hangerNumber}` : ''}
              </p>

              {(o.cutterUserName || o.sewerUserName || o.packerUserName) && (
                <OrderStagesDiagram order={o} />
              )}
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