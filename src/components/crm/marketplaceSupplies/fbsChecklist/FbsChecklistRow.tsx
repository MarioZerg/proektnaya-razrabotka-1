import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import { mpStatusInfo } from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';
import CancelledItemShelfCell from '../CancelledItemShelfCell';
import { sizeOf, type Row } from './fbsChecklistShared';

interface FbsChecklistRowProps {
  row: Row;
  supply: SupplyDetail;
  canEditItems: boolean;
  canRemoveItems: boolean;
  onRemoveItem: (itemId: number) => void;
  onReload: () => void;
  onPrintQr: (row: Row) => void;
  onPrintBundle: (row: Row) => void;
}

/**
 * Одна строка списка. Вынесена в отдельный компонент, чтобы те же строки можно было
 * показать и внутри связки, не дублируя разметку.
 */
const FbsChecklistRow = ({
  row,
  supply,
  canEditItems,
  canRemoveItems,
  onRemoveItem,
  onReload,
  onPrintQr,
  onPrintBundle,
}: FbsChecklistRowProps) => {
  const item = row.item;
  // Связка вещи нужна только для подсветки строки: сама метка живёт в шапке.
  const group = item?.groupKey
    ? supply.groups?.find((g) => g.groupKey === item.groupKey)
    : undefined;
  return (
                <TableRow
                  className={
                    item?.isCancelled
                      ? 'bg-destructive/10'
                      : row.justScanned
                        // Только что отсканированная вещь: яркая рамка, чтобы
                        // кладовщик сразу проверил размер, который положил в короб.
                        ? 'bg-emerald-100 ring-2 ring-inset ring-emerald-500'
                        : row.scanned
                          ? group && !group.isComplete
                            ? 'bg-amber-50'
                            : 'bg-emerald-50'
                          : undefined
                  }
                >
                  <TableCell>
                    {row.scanned ? (
                      <Icon name="CircleCheck" size={18} className="text-emerald-600" />
                    ) : (
                      <Icon name="Circle" size={18} className="text-muted-foreground/40" />
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    <span className="break-all">{row.orderNumber || '—'}</span>
                    {/* Метку «связка 3/4» на самой строке не повторяем: связка
                        названа в шапке над этими строками, и второе такое же
                        число только зашумляет список. */}
                    {/* Вещь не нашли, а листок закройщика с QR потерян — упаковщице
                        нечего сканировать на терминале. Кладовщик печатает бирку с тем
                        же QR прямо отсюда, несёт в цех, и вещь стикеруется как обычно.

                        Кнопку даём у КАЖДОЙ строки, а не только у несобранных: вещь из
                        короба тоже возвращают в цех (порвали пакет, перепутали размер,
                        нужна перестикеровка), и тогда листок нужен точно так же. */}
                    {row.orderNumber && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1 h-7 px-1.5 text-xs text-muted-foreground"
                        title="Напечатать QR-бирку заказа взамен листка закройщика"
                        onClick={() => void onPrintQr(row)}
                      >
                        <Icon name="QrCode" size={14} className="mr-1" />
                        QR заказа
                      </Button>
                    )}
                    {/* Стикер связки — им её и собирают: ярлык маркетплейса у
                        связки один на все вещи, разложить им вещи по одной нельзя.
                        Стикер мнётся и отклеивается на складе, поэтому даём
                        напечатать его заново прямо отсюда. */}
                    {row.bundleBarcode && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1 h-7 px-1.5 text-xs text-muted-foreground"
                        title="Напечатать стикер связки — им сканируют вещь в поставку"
                        onClick={() => void onPrintBundle(row)}
                      >
                        <Icon name="Barcode" size={14} className="mr-1" />
                        Стикер {row.bundleBarcode}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className={row.justScanned ? 'text-base font-bold' : undefined}>
                    {row.material || '—'}
                  </TableCell>
                  {/* Размер только что отсканированной вещи — крупно: именно его
                      кладовщик и сверяет с тем, что держит в руках. */}
                  <TableCell className={row.justScanned ? 'text-lg font-bold' : undefined}>
                    {sizeOf(row.width, row.height)}
                  </TableCell>
                  <TableCell className="text-sm">{row.labeledByName || '—'}</TableCell>
                  <TableCell>
                    {item?.isCancelled ? (
                      <Badge variant="destructive">ЗАКАЗ ОТМЕНЁН</Badge>
                    ) : row.scanned ? (
                      <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                        В поставке
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {row.shelfName ? `Полка «${row.shelfName}»` : 'Ждёт сканирования'}
                      </span>
                    )}
                    {/* Статус НА ПЛОЩАДКЕ: показывает, куда движется отправление —
                        в отгрузку или в отмену. Отмену видно сразу, а не при закрытии. */}
                    {(() => {
                      if (!item || item.isCancelled) return null;
                      const mp = mpStatusInfo(item.mpStatus);
                      if (!mp) return null;
                      return (
                        <div
                          className={`mt-1 text-xs ${
                            mp.tone === 'bad'
                              ? 'font-semibold text-destructive'
                              : mp.tone === 'ok'
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {item.marketplace || 'Площадка'}: {mp.label}
                        </div>
                      );
                    })()}
                  </TableCell>
                  {canEditItems && (
                    <TableCell>
                      {/* Отменённый заказ отгружать нельзя — вместо удаления даём кладовщику
                          выбрать полку и напечатать стикер хранения прямо отсюда. */}
                      {item?.isCancelled ? (
                        <CancelledItemShelfCell
                          item={item}
                          shelves={supply.shelves || []}
                          onDone={onReload}
                        />
                      ) : (
                        item &&
                        canRemoveItems && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onRemoveItem(item.id)}
                          >
                            <Icon name="Trash2" size={14} />
                          </Button>
                        )
                      )}
                    </TableCell>
                  )}
                </TableRow>
  );
};

export default FbsChecklistRow;
