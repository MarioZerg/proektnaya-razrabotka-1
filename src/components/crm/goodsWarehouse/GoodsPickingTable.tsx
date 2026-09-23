import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import ShopBadge from '@/components/crm/ShopBadge';
import type { PickingOrder } from '@/lib/goodsWarehouseApi';
import { shortProductName } from '@/lib/shortProductName';

/** Дата в привычном виде: «10.08.2026, 16:15». */
const formatDate = (value: string | null) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface GoodsPickingTableProps {
  loading: boolean;
  search: string;
  /** Настоящая работа кладовщика — без «лишних» вещей FBO. */
  workOrders: PickingOrder[];
  /** Отобранное поиском подмножество workOrders. */
  filtered: PickingOrder[];
  /** Разбивка отобранного по площадке и схеме: «OZON FBS: 9». */
  byScheme: Record<string, number>;
  /** Открыть карточку вещи. */
  onOpenCard: (id: number) => void;
}

/** Таблица подбора: сводка по схемам сверху и строки вещей с полками. */
const GoodsPickingTable = ({
  loading,
  search,
  workOrders,
  filtered,
  byScheme,
  onOpenCard,
}: GoodsPickingTableProps) => {
  if (loading && workOrders.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {search ? 'По запросу ничего не найдено' : 'Заказов к подбору нет'}
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {search
            ? `Найдено: ${filtered.length} из ${workOrders.length}`
            : `Заказов к подбору: ${workOrders.length}`}
        </p>
        {/* Сколько работы какого вида: FBS собирают поштучно с ярлыками,
            FBO складывают коробкой. Кладовщик планирует день по этим числам. */}
        {Object.entries(byScheme).map(([label, count]) => (
          <Badge key={label} variant="outline" className="font-normal">
            {label}: {count}
          </Badge>
        ))}
      </div>
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="text-primary-foreground">Товар</TableHead>
              <TableHead className="text-primary-foreground">Куда поедет</TableHead>
              <TableHead className="text-primary-foreground">Полка</TableHead>
              <TableHead className="text-primary-foreground">Дата создания</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((o) => (
              <TableRow
                key={o.id}
                onClick={() => onOpenCard(o.id)}
                className="cursor-pointer hover:bg-muted/60"
              >
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    {/* Чья вещь: короба МЕГАТЮЛЬ и ДЮНЫ стоят рядом, и
                        отсканировать её можно только в свою поставку. */}
                    <ShopBadge name={o.shopName} color={o.shopColor} />
                    <span className="font-medium" title={o.product || ''}>
                      {shortProductName(o)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {o.orderNumber || '—'}
                    {o.storageBarcode ? ` · ${o.storageBarcode}` : ''}
                  </div>
                  {/* Стикер напечатан — вещь ОСТАЁТСЯ в общем списке и просто
                      помечается. Раньше она уезжала на отдельную вкладку или
                      вовсе исчезала: кладовщик шёл вдоль стеллажа по списку,
                      строка пропадала, а на полке сотни одинаковых пакетов —
                      найти вещь без номера полки на экране почти невозможно.
                      Из списка вещь уходит только после отправки на поставку. */}
                  {o.shippingLabeledAt && (
                    <div className="mt-1 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                      <Icon name="Printer" size={12} />
                      {o.status === 'awaiting_supply'
                        ? 'Стикер наклеен — отсканируйте в короб'
                        : 'Стикер наклеен — отправьте на поставку'}
                    </div>
                  )}
                </TableCell>
                {/* Куда поедет вещь: площадка и схема. Работа у них разная —
                    на FBS клеится ярлык маркетплейса и вещь едет своим пакетом,
                    FBO уходит коробкой на склад площадки. Кладовщик должен видеть
                    это в списке, а не открывать карточку каждой вещи. */}
                <TableCell className="whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <Badge variant="secondary" className="font-normal">
                      {(o.marketplace || '—').toUpperCase()}
                    </Badge>
                    {o.orderType && (
                      <Badge
                        className={
                          o.orderType === 'FBS'
                            ? 'bg-sky-100 font-semibold text-sky-800 hover:bg-sky-100'
                            : 'bg-violet-100 font-semibold text-violet-800 hover:bg-violet-100'
                        }
                      >
                        {o.orderType}
                      </Badge>
                    )}
                  </div>
                  {o.cluster && (
                    <div className="mt-0.5 text-xs text-muted-foreground">{o.cluster}</div>
                  )}
                </TableCell>
                <TableCell>
                  <div>{o.shelfName || '—'}</div>
                  {/* Запасной вариант: такие же вещи, свободно лежащие на складе.
                      Если по своей полке вещи не оказалось (переложили, забрали и
                      не отметили, ошиблись при инвентаризации), кладовщик сразу
                      видит, есть ли замена и с какой полки её взять — вместо того
                      чтобы отправлять заказ в цех шиться заново. */}
                  {!!o.alsoOnShelves?.length && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Ещё {o.alsoOnShelves.reduce((sum, x) => sum + x.count, 0)} шт:{' '}
                      {o.alsoOnShelves.map((x) => `${x.shelfName} (${x.count})`).join(', ')}
                    </div>
                  )}
                </TableCell>
                {/* Кнопки «Не нашёл» здесь больше нет: она дублировала действие
                    из карточки товара. Решение «вещи нет» платное — заказ едет
                    шиться заново, ткань и работа цеха тратятся второй раз, — и
                    принимать его мимоходом из строки списка не стоит. Теперь оно
                    в карточке, в меню «Действия с товаром», рядом с отправкой
                    в пошив: кладовщик открывает вещь и выбирает, что с ней. */}
                <TableCell className="whitespace-nowrap">{formatDate(o.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
};

export default GoodsPickingTable;
