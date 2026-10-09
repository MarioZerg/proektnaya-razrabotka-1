import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import ShopBadge from '@/components/crm/ShopBadge';
import type { Order } from '@/lib/ordersApi';
import {
  marketplaceLogo,
  formatDate,
  statusBadgeClass,
  shortFio,
  isOrderCancelled,
} from '@/components/crm/sewingItems/sewingItemsShared';
import OrderStagesDiagram from '@/components/crm/sewingItems/OrderStagesDiagram';
import OrderStageAvatars from '@/components/crm/sewingItems/OrderStageAvatars';
import OrderWaitTimer from '@/components/crm/sewingItems/OrderWaitTimer';
import { usePrintOrderSticker } from '@/components/crm/sewingItems/usePrintOrderSticker';
import { isUrgent } from '@/components/crm/sewingItems/orderUrgency';
import { orderHangerLabel } from '@/lib/hangersApi';

interface SewingItemsCardsProps {
  loading: boolean;
  /** FRONTEND-ONLY: сбой GET — не писать «заказов не найдено». */
  error?: string | null;
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

/** Водяной знак площадки: слово-логотип боком в правой белой полосе. */
const marketplaceWatermark: Record<string, { color: string; full: string; short?: string }> = {
  OZON: { color: '#005BFF', full: 'OZON', short: 'OZ' },
  WB: { color: '#CB11AB', full: 'WB' },
  Yandex: { color: '#1a1a1a', full: 'Яндекс' },
};

const MarketplaceCardWatermark = ({
  marketplace,
  sewingStatus,
}: {
  marketplace: string;
  sewingStatus: string;
}) => {
  const mark = marketplaceWatermark[marketplace];
  if (!mark) return null;
  // Короткая карточка «Новый»: полное OZON не помещается — оставляем OZ.
  const compactOzon = marketplace === 'OZON' && sewingStatus === 'Новый';
  const label = compactOzon && mark.short ? mark.short : mark.full;
  const letters = label.length;
  const fontSize = letters <= 2 ? 52 : letters <= 4 ? 40 : 32;
  // viewBox чуть больше слова: SVG с meet впишет знак в слот любой высоты,
  // поэтому на узком и широком экране он не вылезает за край карточки.
  const viewW = fontSize + 16;
  const viewH = Math.round(fontSize * 0.78 * letters) + 20;
  const cx = viewW / 2;
  const cy = viewH / 2;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-y-3 right-1 w-[36%] overflow-hidden"
    >
      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        className="h-full w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <text
          x={cx}
          y={cy}
          fill={mark.color}
          fillOpacity="0.11"
          fontSize={fontSize}
          fontWeight="900"
          fontFamily="Arial, Helvetica, sans-serif"
          letterSpacing={letters <= 2 ? -3 : -1.5}
          textAnchor="middle"
          dominantBaseline="central"
          transform={`rotate(-90 ${cx} ${cy})`}
        >
          {label}
        </text>
      </svg>
    </span>
  );
};

const SewingItemsCards = ({
  loading,
  error = null,
  pagedOrders,
  onOpenDetail,
  page,
  setPage,
  totalPages,
  totalCount,
  canPrintSticker = false,
}: SewingItemsCardsProps) => {
  const { printingId, printSticker: handlePrintSticker } = usePrintOrderSticker();

  if (loading && pagedOrders.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (pagedOrders.length === 0) {
    if (error) return null;
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
            className={`relative flex h-full cursor-pointer flex-col overflow-hidden shadow-none transition-colors ${
              urgent
                ? 'border-2 border-red-500 bg-red-50 hover:bg-red-100'
                : 'border-border hover:bg-muted/40'
            }`}
            onClick={() => onOpenDetail(o)}
          >
            {/* Логотип площадки — задний фон плашки: боком, на всю карточку,
                прозрачный, чтобы сразу читалось «чей заказ», но не спорил с текстом. */}
            <MarketplaceCardWatermark
              marketplace={o.marketplace}
              sewingStatus={o.sewingStatus}
            />
            {/* Цветная полоса слева — маркетплейс заказа, не занимает места в контенте. */}
            <span
              className={`absolute inset-y-0 left-0 w-1 ${ribbonClass[o.marketplace] || 'bg-muted-foreground'}`}
            />
            {/* FBS/FBO — в правом верхнем углу, вне потока: на узкой карточке
                не делит строку с маркетплейсом и таймером и никуда не уезжает. */}
            {o.orderType && (
              <span
                className={`absolute right-0 top-0 z-10 rounded-bl-md px-2 py-1 text-[11px] font-bold leading-none ${
                  o.orderType === 'FBS'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-sky-600 text-white'
                }`}
              >
                {o.orderType}
              </span>
            )}

            <CardContent className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-3 pl-4 pr-12">
              {/* Срочность объявляем строкой во всю ширину, а не значком: маленький
                  бейдж среди прочих терялся, и просроченная вещь лежала в общей куче. */}
              {urgent && (
                <p className="flex items-center gap-1.5 pr-1 text-sm font-extrabold uppercase leading-tight text-red-700">
                  <Icon name="Zap" size={18} className="shrink-0 fill-red-600 text-red-600" />
                  Срочно! Шить вне очереди
                </p>
              )}
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1">
                <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
                  <span
                    className={marketplaceLogo[o.marketplace]?.className || 'font-bold'}
                  >
                    {marketplaceLogo[o.marketplace]?.label || o.marketplace}
                  </span>
                  {/* Чей заказ: упаковка и вложения у магазинов разные.
                      В шапке рядом с площадкой — не отдельной строкой под номером. */}
                  <ShopBadge name={o.shopName} color={o.shopColor} />
                  {/* Заказ покупателя из нескольких вещей едет по одному общему ярлыку —
                      предупреждаем, что вещь нельзя отправлять отдельно от остальных. */}
                  {o.groupSize && o.groupSize > 1 && (
                    <Badge className="bg-violet-600 px-1.5 py-0 text-[10px] text-white hover:bg-violet-600">
                      Заказ {o.groupPosition} из {o.groupSize}
                    </Badge>
                  )}
                  {/* ЭТАП ОВЕРЛОКА. Закройщик по этой метке понимает, что вещь
                      пойдёт не сразу швеям, а сначала на обмётку края; швея
                      видит, что вещь уже обмётана и её можно шить. */}
                  {o.requiresOverlock && (
                    <Badge
                      className={
                        o.overlockedAt
                          ? 'bg-emerald-600 px-1.5 py-0 text-[10px] text-white hover:bg-emerald-600'
                          : 'bg-fuchsia-600 px-1.5 py-0 text-[10px] text-white hover:bg-fuchsia-600'
                      }
                    >
                      {o.overlockedAt ? 'Обработан на оверлоке' : 'Оверлок'}
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
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                  {/* Печать стикера готовой вещи — обе схемы. Для FBS ярлык
                      запрашивается у маркетплейса: если наклейка потерялась,
                      кладовщик печатает её прямо отсюда, не уходя со списка. */}
                  {canPrintSticker && o.sewingStatus === 'Готовые' && (
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
                  )}
                  <OrderWaitTimer order={o} compact />
                  <Badge className={`${statusBadgeClass[o.sewingStatus] || ''} max-w-full whitespace-normal text-[11px]`}>
                    {o.sewingStatus}
                  </Badge>
                </div>
              </div>

              {/* Материал и размер — сразу под маркетплейсом: по ним швея берёт
                  ткань, это главный текст карточки. break-words — длинное имя
                  ткани не раздувает карточку шире экрана. */}
              <p className="break-words text-lg font-extrabold leading-tight">
                {o.material || '—'}
                {o.width && o.height ? ` ${o.width} x ${o.height}` : ''}
              </p>

              {/* Номер заказа — главный опознавательный признак вещи, по нему её ищут и
                  сверяют. Стоит отдельной строкой во всю ширину карточки: в шапке он делил
                  место со значками статуса и срока и разваливался на две строки. Номер
                  длиной до 19 знаков, поэтому на узком экране слегка ужимаем буквы
                  (text-sm) — зато он всегда читается одной строкой. */}
              <p className="overflow-hidden text-ellipsis whitespace-nowrap font-mono-tech text-sm font-bold leading-tight tracking-tight sm:text-base">
                {o.orderNumber}
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

              {/* КРОЙ ВИСИТ С ЧУЖОЙ БИРКОЙ.
                  Заказ отменили после раскроя, ткань уже разрезана — крой отдали
                  этому заказу, чтобы не шить такую же вещь заново. Но бирка на
                  вешалке осталась от отменённого заказа: перепечатать её некому.
                  Без этой строки швея искала бы вешалку по номеру, которого на
                  ней нет. */}
              {o.cutFromOrderNumber && (
                <p className="rounded-sm bg-amber-100 px-2 py-1 text-sm font-semibold text-amber-900">
                  Крой с биркой {o.cutFromOrderNumber}
                </p>
              )}

              {(o.assignedUserName ||
                (o.hangerNumber > 0 &&
                  o.sewingStatus !== 'Новый' &&
                  o.sewingStatus !== 'Готовые')) && (
                <p className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
                  {/* ФИО сокращаем до «Фамилия И.О.»: полное имя занимало всю строку и
                      выдавливало номер вешалки за край — швея не видела, где искать крой.
                      Само имя при нехватке места ужимается, а вешалка (shrink-0) остаётся
                      на экране всегда: это то, зачем в эту строку смотрят. */}
                  {o.assignedUserName && (
                    <span className="truncate">{shortFio(o.assignedUserName)}</span>
                  )}
                  {o.hangerNumber > 0 &&
                    o.sewingStatus !== 'Новый' &&
                    o.sewingStatus !== 'Готовые' && (
                    <span className="shrink-0 whitespace-nowrap font-semibold text-foreground">
                      вешалка {orderHangerLabel(o)}
                    </span>
                  )}
                </p>
              )}

              {o.sewingStatus !== 'Новый' && (
                <div className="mt-auto flex items-end gap-2">
                  <OrderStageAvatars order={o} />
                  <div className="w-fit rounded-tr-md bg-slate-100/90 px-2 py-1 empty:hidden">
                    <OrderStagesDiagram order={o} />
                  </div>
                </div>
              )}

              {/* Вещь отменена покупателем уже ПОСЛЕ раскроя: ткань разрезана,
                  поэтому вещь дошивают, но она поедет не покупателю, а на склад
                  хранения — терминал стикеровки выдаст на неё стикер GW.
                  Внизу карточки: в шапке бейдж боролся за место и вылезал за край. */}
              {isOrderCancelled(o) && (
                <Badge className="mt-auto w-fit max-w-full self-start whitespace-normal bg-red-600 text-[11px] text-white hover:bg-red-600">
                  Отменён → склад
                </Badge>
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