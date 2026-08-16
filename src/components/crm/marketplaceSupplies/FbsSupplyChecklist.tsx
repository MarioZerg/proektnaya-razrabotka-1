import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { SupplyDetail, SupplyItem } from '@/lib/marketplaceSuppliesApi';
import { mpStatusInfo } from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';
import CancelledItemShelfCell from './CancelledItemShelfCell';

interface FbsSupplyChecklistProps {
  supply: SupplyDetail;
  canEditItems: boolean;
  canRemoveItems: boolean;
  onRemoveItem: (itemId: number) => void;
  onReload: () => void;
}

/** Строка списка: либо уже отсканированная вещь, либо та, что ещё ждёт на складе. */
interface Row {
  key: string;
  scanned: boolean;
  orderNumber: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  labeledByName: string | null;
  shelfName?: string | null;
  item?: SupplyItem;
}

const sizeOf = (w: number | null, h: number | null) => (w && h ? `${w}×${h}` : '—');

/**
 * Чек-лист сборки FBS-поставки: один список вместо счётчика и отдельной таблицы.
 *
 * Сверху — то, что уже отсканировано (зелёные строки), ниже — что ещё нужно принести.
 * Кладовщик пикает ярлык, строка зеленеет и уезжает вверх: видно, сколько осталось,
 * и не нужно держать разницу в уме.
 *
 * В списке только застикерованный товар — незастикерованный в поставку и не пустят.
 */
const FbsSupplyChecklist = ({
  supply,
  canEditItems,
  canRemoveItems,
  onRemoveItem,
  onReload,
}: FbsSupplyChecklistProps) => {
  // Хук объявлен до любых ранних выходов: ниже есть return для пустого списка, а
  // порядок хуков в React должен совпадать при каждом рендере.
  const [printing, setPrinting] = useState(false);

  const scannedRows: Row[] = supply.items.map((item) => ({
    key: `in-${item.id}`,
    scanned: true,
    orderNumber: item.orderNumber,
    material: item.material,
    width: item.width,
    height: item.height,
    labeledByName: item.labeledByName ?? null,
    item,
  }));

  const waitingRows: Row[] = (supply.awaitingItems || []).map((a) => ({
    key: `wait-${a.id}`,
    scanned: false,
    orderNumber: a.orderNumber,
    material: a.material,
    width: a.width,
    height: a.height,
    labeledByName: a.labeledByName,
    shelfName: a.shelfName,
  }));

  // Ненайденные — НАВЕРХ. Это и есть работа: собранное кладовщик уже держит в коробе
  // и перечитывать не будет. Раньше список шёл в обратном порядке, и три несобранные
  // вещи прятались в самом низу под полутора сотней зелёных строк — до них нужно было
  // домотать, и казалось, что их вообще нет.
  const rows = [...waitingRows, ...scannedRows];
  const total = rows.length;
  const awaiting = supply.awaitingItems || [];

  // Печать QR-бирки заказа — замена потерянному листку закройщика.
  //
  // Кладовщик собирает поставку и не может найти вещь: она в цехе, но листок с QR
  // потерян или затёрт, и упаковщица не может её застикеровать. Раньше это тупик —
  // приходилось идти к админу и включать ручной поиск. Теперь кладовщик печатает
  // бирку с тем же QR, несёт в цех, и вещь стикеруется обычным путём.
  const handlePrintQr = async (row: Row) => {
    if (!row.orderNumber) return;
    const { printOrderQrTag } = await import('@/lib/printOrderQrTag');
    await printOrderQrTag({
      orderNumber: row.orderNumber,
      material: row.material,
      width: row.width,
      height: row.height,
      marketplace: supply.marketplace,
      orderType: supply.type,
    });
  };

  // Печать листа недостачи: что не доехало до короба и с кого спрашивать.
  //
  // Кладовщик закрывает поставку, а несколько вещей так и не отсканированы — искать
  // их приходится по всему цеху. В листе по каждой позиции сразу есть заказ, размер,
  // полка и три фамилии: кто кроил, кто шил, кто упаковывал, и дата упаковки.
  const handlePrintMissing = async () => {
    if (awaiting.length === 0 || printing) return;
    setPrinting(true);
    try {
      const { printSupplyMissingSheet } = await import('@/lib/printSupplyMissingSheet');
      await printSupplyMissingSheet(
        awaiting,
        `Поставка №${supply.id} · ${supply.marketplace || ''} ${supply.type || ''}`.trim()
      );
    } finally {
      setPrinting(false);
    }
  };

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Нет застикерованного товара. Найдите вещи на складе в разделе «Сборка товара
        с полок», наклейте ярлык маркетплейса — и они появятся здесь
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {/* Поставка уже уехала, а несколько вещей так и не отсканировали в короб.
          Это НЕ потеря и не ошибка: вещи лежат на складе с наклеенными ярлыками и
          ждут следующей поставки. Раньше строка «не отсканировано: 4» висела без
          пояснения, и кладовщик шёл искать вещи, которые никуда не пропадали —
          добавить их в уехавшую поставку всё равно уже нельзя. */}
      {awaiting.length > 0 &&
        supply.status !== 'Открытая' &&
        supply.status !== 'На сборке' && (
        <div className="mt-2 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <Icon name="Info" size={18} className="mt-0.5 shrink-0" />
          <div>
            Эти {awaiting.length} шт. не успели отсканировать до отгрузки. Вещи на месте,
            со стикерами — они ждут в подборе и уедут следующей поставкой. Досканировать
            их в эту поставку уже нельзя.
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <h3 className="text-sm font-semibold">
          Собрано {scannedRows.length} из {total}
          {awaiting.length > 0 && (
            <span className="ml-2 font-normal text-muted-foreground">
              · не отсканировано: {awaiting.length}
            </span>
          )}
        </h3>
        {/* Лист недостачи печатают перед закрытием поставки: по нему ищут вещи,
            которые не доехали до короба. В нём заказ, размер, полка и фамилии —
            кто кроил, шил, упаковывал и когда. */}
        {awaiting.length > 0 && (
          <Button variant="outline" size="sm" onClick={handlePrintMissing} disabled={printing}>
            <Icon
              name={printing ? 'Loader2' : 'Printer'}
              size={14}
              className={`mr-1.5 ${printing ? 'animate-spin' : ''}`}
            />
            Печать недостачи ({awaiting.length})
          </Button>
        )}
      </div>
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="w-10 text-primary-foreground"></TableHead>
              <TableHead className="text-primary-foreground">Заказ</TableHead>
              <TableHead className="text-primary-foreground">Материал</TableHead>
              <TableHead className="text-primary-foreground">Размер</TableHead>
              <TableHead className="text-primary-foreground">Кто стикеровал</TableHead>
              <TableHead className="text-primary-foreground">Статус</TableHead>
              {canEditItems && <TableHead className="text-primary-foreground"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const item = row.item;
              const group = item?.groupKey
                ? supply.groups?.find((g) => g.groupKey === item.groupKey)
                : undefined;
              return (
                <TableRow
                  key={row.key}
                  className={
                    item?.isCancelled
                      ? 'bg-destructive/10'
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
                    {group && (
                      <Badge
                        className={`ml-1.5 px-1.5 py-0 text-[10px] text-white ${
                          group.isComplete
                            ? 'bg-emerald-600 hover:bg-emerald-600'
                            : 'bg-amber-600 hover:bg-amber-600'
                        }`}
                      >
                        связка {group.inSupply}/{group.total}
                      </Badge>
                    )}
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
                        onClick={() => void handlePrintQr(row)}
                      >
                        <Icon name="QrCode" size={14} className="mr-1" />
                        QR заказа
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>{row.material || '—'}</TableCell>
                  <TableCell>{sizeOf(row.width, row.height)}</TableCell>
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
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default FbsSupplyChecklist;