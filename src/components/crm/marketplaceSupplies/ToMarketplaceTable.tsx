import SupplyTypeBadge from './SupplyTypeBadge';
import B2bBadge from './B2bBadge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { Supply } from '@/lib/marketplaceSuppliesApi';
import SupplySewingProgress from '@/components/crm/marketplaceSupplies/SupplySewingProgress';
import ToMarketplaceCards from '@/components/crm/marketplaceSupplies/ToMarketplaceCards';
import { formatDate, formatDateTime } from '@/lib/dateUtils';
import { marketplaceLogo, statusVariant } from './toMarketplaceConstants';

interface ToMarketplaceTableProps {
  loading: boolean;
  /** FRONTEND-ONLY: сбой GET — не писать «поставок пока нет». */
  error?: string | null;
  supplies: Supply[];
  onOpen: (id: number) => void;
}

/** Сколько товара в поставке — одна строка для таблицы и карточки. */
const ItemsSummary = ({ s }: { s: Supply }) => {
  if (s.marketplace === 'WB' && s.type === 'FBS') {
    return (
      <Badge variant={s.itemsCount > 0 ? 'default' : 'outline'}>{s.itemsCount} шт.</Badge>
    );
  }
  if (s.type === 'FBO' && s.plannedQuantity) {
    // Поставку FBO не выпустят, пока не собрано всё по заявке —
    // показываем недобор сразу в списке, а не при попытке отгрузить.
    return (
      <span
        className={
          s.itemsCount >= s.plannedQuantity
            ? 'font-medium text-emerald-600'
            : 'font-medium text-amber-600'
        }
      >
        {s.itemsCount} из {s.plannedQuantity} шт.
      </span>
    );
  }
  return <span>{s.itemsCount} шт.</span>;
};

const ToMarketplaceTable = ({ loading, error = null, supplies, onOpen }: ToMarketplaceTableProps) => {
  if (loading && supplies.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (supplies.length === 0) {
    if (error) return null;
    return <p className="text-sm text-muted-foreground">Поставок пока нет</p>;
  }

  return (
    <>
      {/* До lg контент CRM узкий (сайдбар + планшет): шесть колонок table-fixed
          сжимают заголовки в кашу. Карточки — как у приёмки. */}
      <div className="lg:hidden">
        <ToMarketplaceCards supplies={supplies} onOpen={onOpen} />
      </div>
      {/* Четыре колонки вместо шести: маркетплейс в «Поставке», пошив рядом
          с товарами — на ширине ~1000px строка читается без горизонтального скролла. */}
      <div className="hidden min-w-0 overflow-hidden rounded-md border border-border lg:block">
        <Table className="min-w-0 table-fixed">
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="w-[34%] whitespace-normal text-primary-foreground">
                Поставка
              </TableHead>
              <TableHead className="w-[18%] whitespace-normal text-primary-foreground">
                Статус
              </TableHead>
              <TableHead className="w-[24%] whitespace-normal text-primary-foreground">
                Товары / пошив
              </TableHead>
              <TableHead className="w-[24%] whitespace-normal text-primary-foreground">
                Сроки
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {supplies.map((s) => (
              <TableRow
                key={s.id}
                // Открываем по нажатию на всю строку: попасть в неё пальцем на
                // планшете проще, чем в маленькую кнопку у края экрана.
                role="button"
                tabIndex={0}
                className="cursor-pointer"
                onClick={() => onOpen(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(s.id);
                  }
                }}
              >
                <TableCell className="whitespace-normal break-words align-top">
                  <div className="font-semibold">
                    <SupplyTypeBadge type={s.type} className="mr-2 align-middle" />
                    {s.supplyNumber || `Поставка №${s.id}`}
                    {s.isB2b && <B2bBadge className="ml-2 align-middle" />}
                  </div>
                  <div className="mt-0.5">
                    <span className={marketplaceLogo[s.marketplace]?.className}>
                      {marketplaceLogo[s.marketplace]?.label || s.marketplace}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    #{s.id}
                    {/* Газелька возит только FBO — у FBS эта строка лишняя. */}
                    {s.type !== 'FBS' && s.gazelkaId ? ` · Газелька ${s.gazelkaId}` : ''}
                  </div>
                  {s.supplyBarcode && (
                    <div className="break-all text-xs text-muted-foreground">{s.supplyBarcode}</div>
                  )}
                  {s.cluster && (
                    <div className="text-xs text-muted-foreground">({s.cluster})</div>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal align-top">
                  <div className="flex flex-col items-start gap-1">
                    <Badge className={statusVariant[s.status]?.className}>{s.status}</Badge>
                    {s.status === 'Отгрузка' && !!s.fbsMissingCount && (
                      <span className="inline-flex items-center gap-1 rounded-sm bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                        <Icon name="TriangleAlert" size={11} className="shrink-0" />
                        Не отсканировано: {s.fbsMissingCount}
                      </span>
                    )}
                    {/* Поставку уже собирает другой кладовщик — видно сразу в списке,
                        чтобы человек не заходил внутрь впустую. */}
                    {s.lockedByName && (
                      <span className="inline-flex max-w-full items-center gap-1 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                        <Icon name="Lock" size={11} className="shrink-0" />
                        <span className="min-w-0 break-words">Собирает: {s.lockedByName}</span>
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal align-top">
                  <div className="space-y-1.5">
                    <ItemsSummary s={s} />
                    {/* Сколько застикерованного товара уже ждёт этой поставки.
                        Без этой строки только что созданная поставка выглядела
                        пустой («0 шт.»), хотя контейнер стоял рядом собранный. */}
                    {!!s.readyToScanCount && s.status !== 'Выполнена' && (
                      <div className="text-xs text-amber-700">
                        ждёт сканирования: {s.readyToScanCount}
                      </div>
                    )}
                    {(s.sewingTotal || 0) > 0 && (
                      <SupplySewingProgress
                        total={s.sewingTotal || 0}
                        done={s.sewingDone || 0}
                        compact
                      />
                    )}
                  </div>
                </TableCell>
                {/* Пустые даты не печатаем: у открытой поставки три прочерка —
                    это шум, а не информация. */}
                <TableCell className="whitespace-normal align-top text-xs">
                  <div className="text-muted-foreground">
                    Создан: {formatDateTime(s.createdAt)}
                  </div>
                  {s.type !== 'FBS' && s.shipToGazelkaAt && (
                    <div className="text-muted-foreground">
                      В Газельку: {formatDate(s.shipToGazelkaAt)}
                    </div>
                  )}
                  {s.shipToMarketplaceAt && (
                    <div className="text-muted-foreground">
                      В маркет: {formatDate(s.shipToMarketplaceAt)}
                    </div>
                  )}
                  {s.completedAt && (
                    <div className="font-medium text-emerald-600">
                      Выполнен: {formatDate(s.completedAt)}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
};

export default ToMarketplaceTable;
