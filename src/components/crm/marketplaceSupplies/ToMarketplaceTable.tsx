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
import { formatDate, formatDateTime } from '@/lib/dateUtils';
import { marketplaceLogo, statusVariant } from './toMarketplaceConstants';

interface ToMarketplaceTableProps {
  loading: boolean;
  supplies: Supply[];
  onOpen: (id: number) => void;
}

const ToMarketplaceTable = ({ loading, supplies, onOpen }: ToMarketplaceTableProps) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (supplies.length === 0) {
    return <p className="text-sm text-muted-foreground">Поставок пока нет</p>;
  }

  return (
    // Таблица без горизонтальной прокрутки.
    // Раньше колонок было тринадцать, и кнопка открытия стояла последней —
    // за краем экрана. Кладовщик на планшете сначала листал таблицу вправо
    // и только потом мог зайти в поставку. Теперь связанные данные собраны
    // в одну ячейку (номер с штрихкодом, четыре даты — в колонку «Сроки»),
    // всё помещается на экран, а открывается поставка нажатием на строку.
    <div className="overflow-hidden rounded-md border border-border">
      <Table className="min-w-0 table-fixed">
        <TableHeader>
          <TableRow className="bg-primary hover:bg-primary">
            <TableHead className="w-[26%] whitespace-normal text-primary-foreground">Поставка</TableHead>
            <TableHead className="w-[16%] whitespace-normal text-primary-foreground">Статус</TableHead>
            <TableHead className="w-[14%] whitespace-normal text-primary-foreground">Маркетплейс</TableHead>
            <TableHead className="w-[13%] whitespace-normal text-primary-foreground">Товаров</TableHead>
            <TableHead className="w-[13%] whitespace-normal text-primary-foreground">Сшито</TableHead>
            <TableHead className="w-[18%] whitespace-normal text-primary-foreground">Сроки</TableHead>
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
                  {s.supplyNumber || `Поставка №${s.id}`}
                </div>
                <div className="text-xs text-muted-foreground">
                  #{s.id}
                  {s.type ? ` · ${s.type}` : ''}
                  {s.gazelkaId ? ` · Газелька ${s.gazelkaId}` : ''}
                </div>
                {s.supplyBarcode && (
                  <div className="text-xs text-muted-foreground">{s.supplyBarcode}</div>
                )}
                {s.cluster && (
                  <div className="text-xs text-muted-foreground">({s.cluster})</div>
                )}
              </TableCell>
              <TableCell className="whitespace-normal align-top">
                <div className="flex flex-col items-start gap-1">
                  <Badge className={statusVariant[s.status]?.className}>{s.status}</Badge>
                  {/* Поставку уже собирает другой кладовщик — видно сразу в списке,
                      чтобы человек не заходил внутрь впустую. */}
                  {s.lockedByName && (
                    <span className="inline-flex items-center gap-1 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-900">
                      <Icon name="Lock" size={11} />
                      Собирает: {s.lockedByName}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="whitespace-normal align-top">
                <span className={marketplaceLogo[s.marketplace]?.className}>
                  {marketplaceLogo[s.marketplace]?.label || s.marketplace}
                </span>
              </TableCell>
              <TableCell className="whitespace-normal align-top">
                {s.marketplace === 'WB' && s.type === 'FBS' ? (
                  <Badge variant={s.itemsCount > 0 ? 'default' : 'outline'}>
                    {s.itemsCount} шт.
                  </Badge>
                ) : s.type === 'FBO' && s.plannedQuantity ? (
                  // Поставку FBO не выпустят, пока не собрано всё по заявке —
                  // показываем недобор сразу в списке, а не при попытке отгрузить.
                  <span
                    className={
                      s.itemsCount >= s.plannedQuantity
                        ? 'font-medium text-emerald-600'
                        : 'font-medium text-amber-600'
                    }
                  >
                    {s.itemsCount} из {s.plannedQuantity} шт.
                  </span>
                ) : (
                  `${s.itemsCount} шт.`
                )}
                {/* Сколько застикерованного товара уже ждёт этой поставки.
                    Без этой строки только что созданная поставка выглядела
                    пустой («0 шт.»), хотя контейнер стоял рядом собранный, —
                    кладовщик не понимал, есть ли смысл заходить внутрь.
                    У закрытых поставок не показываем: работа по ним окончена. */}
                {!!s.readyToScanCount && s.status !== 'Выполнена' && (
                  <div className="mt-0.5 text-xs text-amber-700">
                    ждёт сканирования: {s.readyToScanCount}
                  </div>
                )}
              </TableCell>
              <TableCell className="whitespace-normal align-top">
                <SupplySewingProgress total={s.sewingTotal || 0} done={s.sewingDone || 0} />
              </TableCell>
              {/* Четыре даты в одной ячейке. Пустые не печатаем: у открытой
                  поставки три прочерка из четырёх — это шум, а не информация. */}
              <TableCell className="whitespace-normal align-top text-xs">
                <div className="text-muted-foreground">
                  Создан: {formatDateTime(s.createdAt)}
                </div>
                {s.shipToGazelkaAt && (
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
  );
};

export default ToMarketplaceTable;
