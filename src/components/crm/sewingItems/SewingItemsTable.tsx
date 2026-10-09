import type { Dispatch, SetStateAction } from 'react';
import { usePrintOrderSticker } from '@/components/crm/sewingItems/usePrintOrderSticker';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
} from '@/components/ui/pagination';
import Icon from '@/components/ui/icon';
import ShopBadge from '@/components/crm/ShopBadge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Order } from '@/lib/ordersApi';
import {
  formatDate,
  statusBadgeClass,
  statusRailClass,
  isOrderCancelled,
  isOnOverlock,
} from '@/components/crm/sewingItems/sewingItemsShared';
import OrderWaitTimer from '@/components/crm/sewingItems/OrderWaitTimer';
import SewingItemsCards from '@/components/crm/sewingItems/SewingItemsCards';
import { isUrgent } from '@/components/crm/sewingItems/orderUrgency';
import OrderStagesDiagram from '@/components/crm/sewingItems/OrderStagesDiagram';
import OrderStageAvatars from '@/components/crm/sewingItems/OrderStageAvatars';
import { orderHangerLabel } from '@/lib/hangersApi';
import { useConveyorRowMotion } from '@/components/crm/sewingItems/useConveyorRowMotion';

/**
 * Печать стикера для готового заказа — прямо у номера в списке.
 *
 * Доступно кладовщику и админу (флаг canPrint). Работает для обеих схем:
 *   · FBO — печатаем наш складской стикер;
 *   · FBS — запрашиваем ярлык у маркетплейса (OZON, WB, Яндекс).
 *
 * FBS раньше отсюда не печатался: если ярлык потерялся или не пропечатался,
 * кладовщику приходилось искать вещь на складе и печатать из другого раздела.
 * Вещь при этом лежит готовая, а отгрузить её без ярлыка нельзя.
 */
const canPrintStickerForOrder = (o: Order, canPrint: boolean) =>
  canPrint && o.sewingStatus === 'Готовые';

/** Компактный список страниц с многоточиями: первая, последняя, текущая и соседние.
 * Например при 42 страницах и текущей 6-й: [1, '…', 5, 6, 7, '…', 42]. */
const buildPageList = (current: number, total: number): Array<number | 'ellipsis'> => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: Array<number | 'ellipsis'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push('ellipsis');
  for (let p = start; p <= end; p += 1) pages.push(p);
  if (end < total - 1) pages.push('ellipsis');
  pages.push(total);
  return pages;
};

const stageLabel = (o: Order) => (isOnOverlock(o) ? 'Оверлок' : o.sewingStatus);

const marketplaceCornerClass: Record<string, string> = {
  OZON: 'bg-[#005BFF] text-white',
  WB: 'bg-[#CB11AB] text-white',
  Yandex: 'bg-neutral-900 text-[#FFCC00]',
};

const marketplaceCornerLabel: Record<string, string> = {
  OZON: 'OZON',
  WB: 'WB',
  Yandex: 'Яндекс',
};

const railOf = (o: Order) => {
  if (isOrderCancelled(o)) return statusRailClass.Отменён;
  return statusRailClass[stageLabel(o)] || 'bg-slate-400';
};

interface SewingItemsTableProps {
  loading: boolean;
  /** FRONTEND-ONLY: сбой GET — не писать «заказов не найдено». */
  error?: string | null;
  pagedOrders: Order[];
  onOpenDetail: (order: Order) => void;
  page: number;
  setPage: Dispatch<SetStateAction<number>>;
  totalPages: number;
  totalCount?: number;
  /** Печать стикера FBO доступна только кладовщику и админу. */
  canPrintSticker?: boolean;
}

const SewingItemsTable = ({
  loading,
  error = null,
  pagedOrders,
  onOpenDetail,
  page,
  setPage,
  totalPages,
  totalCount = 0,
  canPrintSticker = false,
}: SewingItemsTableProps) => {
  const { printingId, printSticker: handlePrintSticker } = usePrintOrderSticker();
  const { arrived, moved, bindRow } = useConveyorRowMotion(pagedOrders);

  if (loading && pagedOrders.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (error && pagedOrders.length === 0) return null;

  return (
    <>
      <div className="md:hidden">
        <SewingItemsCards
          loading={loading}
          error={error}
          pagedOrders={pagedOrders}
          onOpenDetail={onOpenDetail}
          page={page}
          setPage={setPage}
          totalPages={totalPages}
          totalCount={totalCount}
          canPrintSticker={canPrintSticker}
        />
      </div>

      <div className="hidden space-y-2 md:block">
        {pagedOrders.map((o) => {
          const urgent = isUrgent(o);
          const cancelled = isOrderCancelled(o);
          const isNew = o.sewingStatus === 'Новый';
          const isReady = o.sewingStatus === 'Готовые';
          const showHanger = !isNew && !isReady;
          const stage = stageLabel(o);
          const justArrived = arrived.has(o.id);
          const justMoved = moved.has(o.id);
          return (
            <div
              key={o.id}
              ref={bindRow(o.id)}
              role="button"
              tabIndex={0}
              onClick={() => onOpenDetail(o)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenDetail(o);
                }
              }}
              className={`relative flex min-w-0 cursor-pointer overflow-hidden rounded-lg border text-left shadow-none outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring ${
                justArrived ? 'animate-conveyor-arrive' : ''
              } ${
                urgent
                  ? 'border-red-400 bg-red-50 hover:bg-red-100'
                  : cancelled
                    ? 'border-red-200 bg-red-50/40 hover:bg-red-50'
                    : 'border-border bg-card hover:bg-muted/40'
              }`}
            >
              <span
                aria-hidden
                className={`w-1.5 shrink-0 ${railOf(o)} ${justArrived ? 'animate-belt' : ''}`}
                style={
                  justArrived
                    ? {
                        backgroundImage:
                          'repeating-linear-gradient(180deg, rgba(255,255,255,0.35) 0 6px, transparent 6px 12px)',
                        backgroundSize: '100% 24px',
                      }
                    : undefined
                }
              />

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex flex-wrap items-start justify-between gap-1">
                  <div className="flex min-w-0 flex-wrap items-stretch">
                    {urgent && (
                      <span className="inline-flex items-center gap-1 rounded-br-md bg-red-600 px-2 py-1 text-[11px] font-extrabold uppercase leading-none text-white">
                        <Icon name="Zap" size={12} className="shrink-0 fill-white text-white" />
                        Срочно
                        <span className="hidden lg:inline"> · вне очереди</span>
                      </span>
                    )}
                    {(o.marketplaceCreatedAt || o.createdAt) && (
                      <span
                        className={`inline-flex items-center px-2 py-1 text-[11px] font-semibold leading-none tabular-nums ${
                          urgent
                            ? 'text-red-800'
                            : 'rounded-br-md bg-slate-100 text-slate-700'
                        }`}
                      >
                        {formatDate(o.marketplaceCreatedAt || o.createdAt)}
                      </span>
                    )}
                    {o.completedAt && (
                      <span className="inline-flex items-center px-2 py-1 text-[11px] leading-none text-muted-foreground">
                        готов {formatDate(o.completedAt)}
                      </span>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    <OrderWaitTimer order={o} compact />
                    {(o.marketplace || o.orderType) && (
                      <span className="inline-flex overflow-hidden rounded-bl-md">
                        {o.marketplace && (
                          <span
                            className={`px-2 py-1 text-[11px] font-bold leading-none ${
                              marketplaceCornerClass[o.marketplace] || 'bg-slate-700 text-white'
                            }`}
                          >
                            {marketplaceCornerLabel[o.marketplace] || o.marketplace}
                          </span>
                        )}
                        {o.orderType && (
                          <span
                            className={`px-2 py-1 text-[11px] font-bold leading-none ${
                              o.orderType === 'FBS'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-sky-600 text-white'
                            }`}
                          >
                            {o.orderType}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5">
                  <div className="flex shrink-0 flex-col gap-1">
                    <Badge
                      className={`${statusBadgeClass[stage] || ''} w-fit whitespace-nowrap ${
                        justMoved ? 'animate-moved-glow' : ''
                      }`}
                    >
                      {stage}
                    </Badge>
                    {cancelled && (
                      <Badge className="w-fit whitespace-nowrap bg-red-600 text-white hover:bg-red-600">
                        Отменён
                        <span className="hidden xl:inline"> → склад</span>
                      </Badge>
                    )}
                  </div>

                  <div className="min-w-[9rem] flex-1 basis-[12rem]">
                    <p className="truncate text-base font-bold leading-tight">
                      {o.material || '—'}
                      {o.width && o.height ? ` ${o.width}×${o.height}` : ''}
                    </p>
                    <p className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="min-w-0 truncate font-mono-tech text-sm font-semibold">
                        {o.orderNumber}
                      </span>
                      <ShopBadge name={o.shopName} color={o.shopColor} />
                      {canPrintStickerForOrder(o, canPrintSticker) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              disabled={printingId === o.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handlePrintSticker(o);
                              }}
                              className="text-muted-foreground hover:text-blue-600 disabled:opacity-50"
                              aria-label={
                                o.orderType === 'FBS'
                                  ? 'Печать ярлыка маркетплейса'
                                  : 'Печать стикера FBO'
                              }
                            >
                              <Icon
                                name={printingId === o.id ? 'Loader2' : 'Printer'}
                                size={15}
                                className={printingId === o.id ? 'animate-spin' : undefined}
                              />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {o.orderType === 'FBS'
                              ? `Ярлык ${o.marketplace || 'маркетплейса'}`
                              : 'Печать стикера FBO'}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </p>
                    {(o.cluster ||
                      (o.groupSize && o.groupSize > 1) ||
                      (o.requiresOverlock && !isOnOverlock(o)) ||
                      o.isLegalEntity) && (
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm">
                      {o.cluster && (
                        <span className="font-semibold text-sky-800">{o.cluster}</span>
                      )}
                      {o.groupSize && o.groupSize > 1 && (
                        <Badge className="bg-violet-600 px-1.5 py-0 text-[10px] text-white hover:bg-violet-600">
                          {o.groupPosition} из {o.groupSize}
                        </Badge>
                      )}
                      {o.requiresOverlock && !isOnOverlock(o) && (
                        <span
                          className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
                            o.overlockedAt
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-fuchsia-100 text-fuchsia-800'
                          }`}
                        >
                          {o.overlockedAt ? 'Обработан на оверлоке' : 'Оверлок'}
                        </span>
                      )}
                      {o.isLegalEntity && (
                        <span className="rounded-sm bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800">
                          Юр. лицо
                        </span>
                      )}
                    </p>
                    )}
                    {o.cutFromOrderNumber && (
                      <p className="mt-0.5 w-fit rounded-sm bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                        Крой с биркой {o.cutFromOrderNumber}
                      </p>
                    )}
                  </div>

                  <Button
                    size="sm"
                    className="ml-auto shrink-0 bg-orange-500 text-white hover:bg-orange-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDetail(o);
                    }}
                  >
                    <Icon name="Eye" size={14} className="mr-1.5" />
                    Просмотр
                  </Button>
                </div>

                {!isNew && (
                  <div className="mt-auto flex items-end justify-between gap-2 px-3 pb-2">
                    <div className="flex min-w-0 items-end gap-2">
                      <OrderStageAvatars order={o} />
                      <div className="rounded-tr-md bg-slate-100/90 px-2 py-1 empty:hidden">
                        <OrderStagesDiagram order={o} />
                      </div>
                    </div>
                    {showHanger && (
                      <p className="truncate text-xs font-semibold">
                        {o.hangerNumber > 0 ? `вешалка ${orderHangerLabel(o)}` : 'вешалка —'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="hidden md:block">
          <Pagination>
            <PaginationContent className="flex-wrap justify-center">
              <PaginationItem>
                <PaginationLink
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className={`cursor-pointer ${page === 1 ? 'pointer-events-none opacity-40' : ''}`}
                >
                  <Icon name="ChevronLeft" size={16} />
                </PaginationLink>
              </PaginationItem>
              {buildPageList(page, totalPages).map((p, i) =>
                p === 'ellipsis' ? (
                  <PaginationItem key={`e${i}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      isActive={p === page}
                      onClick={() => setPage(p)}
                      className="cursor-pointer"
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}
              <PaginationItem>
                <PaginationLink
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className={`cursor-pointer ${page === totalPages ? 'pointer-events-none opacity-40' : ''}`}
                >
                  <Icon name="ChevronRight" size={16} />
                </PaginationLink>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </>
  );
};

export default SewingItemsTable;
