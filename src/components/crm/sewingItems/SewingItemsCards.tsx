import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';
import {
  marketplaceLogo,
  formatDate,
  statusBadgeClass,
  shortFio,
} from '@/components/crm/sewingItems/sewingItemsShared';
import OrderStagesDiagram from '@/components/crm/sewingItems/OrderStagesDiagram';
import OrderWaitTimer from '@/components/crm/sewingItems/OrderWaitTimer';
import { printFboSticker } from '@/lib/printFboSticker';
import { isUrgent } from '@/components/crm/sewingItems/orderUrgency';
import { orderHangerLabel } from '@/lib/hangersApi';

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
        {pagedOrders.map((o) => {
          // Просроченный заказ: срок отгрузки вышел, шить надо вне очереди.
          const urgent = isUrgent(o);
          return (
          <Card
            key={o.id}
            className={`relative cursor-pointer overflow-hidden shadow-none transition-colors ${
              urgent
                ? 'border-2 border-red-500 bg-red-50 hover:bg-red-100'
                : 'border-border hover:bg-muted/40'
            }`}
            onClick={() => onOpenDetail(o)}
          >
            {/* Цветная полоса слева — маркетплейс заказа, не занимает места в контенте. */}
            <span
              className={`absolute inset-y-0 left-0 w-1 ${ribbonClass[o.marketplace] || 'bg-muted-foreground'}`}
            />

            <CardContent className="space-y-2 p-3 pl-4">
              {/* Срочность объявляем строкой во всю ширину, а не значком: маленький
                  бейдж среди прочих терялся, и просроченная вещь лежала в общей куче. */}
              {urgent && (
                <p className="flex items-center gap-1.5 text-sm font-extrabold uppercase text-red-700">
                  <Icon name="Zap" size={18} className="shrink-0 fill-red-600 text-red-600" />
                  Срочно! Шить вне очереди
                </p>
              )}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span
                      className={marketplaceLogo[o.marketplace]?.className || 'font-bold'}
                    >
                      {marketplaceLogo[o.marketplace]?.label || o.marketplace}
                    </span>
                    {/* FBS/FBO определяет, куда вещь поедет и как срочно — выделяем. */}
                    <Badge
                      variant="outline"
                      className={`px-2 py-0 text-xs font-bold ${
                        o.orderType === 'FBS'
                          ? 'border-emerald-500 text-emerald-700'
                          : 'border-sky-500 text-sky-700'
                      }`}
                    >
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

              {/* Номер заказа — главный опознавательный признак вещи, по нему её ищут и
                  сверяют. Стоит отдельной строкой во всю ширину карточки: в шапке он делил
                  место со значками статуса и срока и разваливался на две строки. Номер
                  длиной до 19 знаков, поэтому на узком экране слегка ужимаем буквы
                  (text-sm) — зато он всегда читается одной строкой. */}
              <p className="overflow-hidden text-ellipsis whitespace-nowrap font-mono-tech text-sm font-bold leading-tight tracking-tight sm:text-base">
                {o.orderNumber}
              </p>

              {/* Материал и размер — то, по чему швея берёт ткань в работу. Самый
                  крупный текст карточки: видно с вытянутой руки, не наклоняясь. */}
              <p className="text-lg font-extrabold leading-tight">
                {o.material || '—'}
                {o.width && o.height ? ` ${o.width} x ${o.height}` : ''}
              </p>

              {/* Кластер — город, куда поедет вещь. Есть только у FBO. */}
              {o.cluster && (
                <p className="flex items-center gap-1 text-sm font-bold text-sky-800">
                  <Icon name="MapPin" size={14} className="shrink-0" />
                  {o.cluster}
                </p>
              )}

              <p className="text-sm font-semibold">
                {formatDate(o.marketplaceCreatedAt || o.createdAt)}
              </p>

              {(o.assignedUserName || o.hangerNumber > 0) && (
                <p className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
                  {/* ФИО сокращаем до «Фамилия И.О.»: полное имя занимало всю строку и
                      выдавливало номер вешалки за край — швея не видела, где искать крой.
                      Само имя при нехватке места ужимается, а вешалка (shrink-0) остаётся
                      на экране всегда: это то, зачем в эту строку смотрят. */}
                  {o.assignedUserName && (
                    <span className="truncate">{shortFio(o.assignedUserName)}</span>
                  )}
                  {o.hangerNumber > 0 && (
                    <span className="shrink-0 whitespace-nowrap font-semibold text-foreground">
                      вешалка {orderHangerLabel(o)}
                    </span>
                  )}
                </p>
              )}

              {(o.cutterUserName || o.sewerUserName || o.packerUserName) && (
                <OrderStagesDiagram order={o} />
              )}
            </CardContent>
          </Card>
          );
        })}
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