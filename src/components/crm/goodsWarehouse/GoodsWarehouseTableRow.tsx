import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { zoneDotClass, zoneLabels } from '@/lib/workZone';
import { shortProductName } from '@/lib/shortProductName';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { Checkbox } from '@/components/ui/checkbox';
import { printStorageSticker } from '@/lib/printStorageSticker';
import { printIndividualSticker } from '@/lib/printIndividualSticker';
import {
  formatDate,
  statusLabels,
  statusVariant,
  statusZone,
  reasonLabels,
  canPrintMarketplaceLabel,
  canPrintStorageSticker,
} from '@/components/crm/goodsWarehouse/goodsWarehouseShared';

interface GoodsWarehouseTableRowProps {
  i: GoodsWarehouseItem;
  isAdmin: boolean;
  onDelete?: (id: number) => Promise<void>;
  pickMode: boolean;
  pickedIds: number[];
  onTogglePick?: (id: number) => void;
  canPrintStickers: boolean;
  canPrintShelfSticker: (item: GoodsWarehouseItem) => boolean;
  canPrintMpLabels: boolean;
  selectedIds: number[];
  toggleOne: (id: number) => void;
  labelBusyId: number | null;
  onPrintMpLabel: (item: GoodsWarehouseItem) => void;
  onRequestDelete: (id: number) => void;
}

/** Одна строка таблицы склада: галочки, товар, статус, стикеры, полка и даты. */
const GoodsWarehouseTableRow = ({
  i,
  isAdmin,
  onDelete,
  pickMode,
  pickedIds,
  onTogglePick,
  canPrintStickers,
  canPrintShelfSticker,
  canPrintMpLabels,
  selectedIds,
  toggleOne,
  labelBusyId,
  onPrintMpLabel,
  onRequestDelete,
}: GoodsWarehouseTableRowProps) => {
  return (
              <TableRow
                className={
                  pickMode && pickedIds.includes(i.id)
                    ? 'bg-primary/5 hover:bg-primary/10'
                    : i.receiveReason === 'admin'
                      ? 'bg-amber-50 hover:bg-amber-100'
                      : ''
                }
              >
                {/* Отбор в поставку: отмечаем только вещи на хранении — остальные
                    физически заняты и заявить их нельзя. */}
                {pickMode && (
                  <TableCell>
                    {i.status === 'in_stock' && (
                      <Checkbox
                        checked={pickedIds.includes(i.id)}
                        onCheckedChange={() => onTogglePick?.(i.id)}
                        aria-label={`Забрать ${i.storageBarcode}`}
                      />
                    )}
                  </TableCell>
                )}
                {/* Галочка есть только у вещей, которым положен стикер: отгруженную
                    или утерянную печатать некуда — её на складе уже нет. */}
                {canPrintStickers && (
                  <TableCell>
                    {canPrintStorageSticker(i) && (
                      <Checkbox
                        checked={selectedIds.includes(i.id)}
                        onCheckedChange={() => toggleOne(i.id)}
                        aria-label={`Выбрать ${i.storageBarcode}`}
                      />
                    )}
                  </TableCell>
                )}
                {/* Товар: что за вещь, её размеры и номер заказа — по ним кладовщик
                    опознаёт её на полке. */}
                <TableCell>
                  {/* Коротко: ткань и размер — по ним вещь ищут на полке. Полный
                      заголовок с маркетплейса занимал три строки и прятал главное;
                      он остался в подсказке при наведении. */}
                  <div className="font-medium" title={i.product || ''}>
                    {shortProductName(i)}
                  </div>
                  <div className="text-xs text-muted-foreground">{i.orderNumber || '—'}</div>
                  {i.status === 'lost' && i.lostReason && (
                    <div className="text-xs text-destructive">
                      {/* Отправленную в пошив вещь называем своими словами: для админа
                          это не «утеря», а решение кладовщика — за ним ткань и работа
                          цеха заново. Рядом — кто именно отправил. */}
                      {i.lostReason.includes('пошив')
                        ? `Отправлена в пошив: ${i.lostReason.replace(/^Брак, отправлен в пошив:\s*/, '')}`
                        : `Причина: ${i.lostReason}`}
                      {i.lostByName ? ` · ${i.lostByName}` : ''}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {/* Цветная точка = чья это работа: фиолетовая — цех, зелёная —
                      склад, двухцветная — момент передачи между ними. */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${zoneDotClass[statusZone[i.status]]}`}
                      title={zoneLabels[statusZone[i.status]]}
                    />
                    <Badge variant={statusVariant[i.status]}>{statusLabels[i.status]}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {reasonLabels[i.receiveReason] || 'Принят вручную'}
                  </div>
                </TableCell>
                {/* Стикер хранения: номер и кнопка перепечатать, если наклейка потерялась. */}
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono-tech text-xs">{i.storageBarcode}</span>
                    {canPrintShelfSticker(i) && canPrintStorageSticker(i) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="Напечатать стикер хранения"
                      onClick={() =>
                        // Индивидуальному пошиву — свой стикер с тканью и размерами:
                        // такие вещи опознают на полке по ним, а не по артикулу.
                        i.receiveReason === 'individual'
                          ? printIndividualSticker({
                              orderNumber: i.orderNumber || '',
                              material: i.material,
                              width: i.width,
                              height: i.height,
                              storageBarcode: i.storageBarcode,
                              product: i.product,
                            })
                          : printStorageSticker({
                              storageBarcode: i.storageBarcode,
                              title: i.product,
                              orderNumber: i.orderNumber,
                            })
                      }
                    >
                      <Icon name="Barcode" size={12} />
                    </Button>
                    )}

                    {/* ПЕРЕпечатка ярлыка маркетплейса для вещи, закреплённой за
                        отправлением. Главный случай — порвался пакет: вещь перекладывают
                        в новый, а ярлык остался на старом. Код при перепечатке тот же,
                        так что «лишних» отправлений не появляется. */}
                    {canPrintMpLabels && canPrintMarketplaceLabel(i) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title={`Напечатать ярлык ${(i.marketplace || 'маркетплейса').toUpperCase()} по заказу ${i.reservedOrderNumber || i.orderNumber || ''}`}
                        disabled={labelBusyId === i.id}
                        onClick={() => onPrintMpLabel(i)}
                      >
                        <Icon
                          name={labelBusyId === i.id ? 'Loader2' : 'Printer'}
                          size={12}
                          className={labelBusyId === i.id ? 'animate-spin' : ''}
                        />
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell>{i.shelfName || '—'}</TableCell>
                <TableCell>{i.shippedAt ? formatDate(i.shippedAt) : '—'}</TableCell>
                {/* Дата возврата: когда вещь приехала обратно и легла на склад. */}
                <TableCell>{formatDate(i.receivedAt)}</TableCell>
                {/* Удаление доступно только администратору: для вещей на хранении и на
                    разборе с производства. Во втором случае это ошибочные приёмки и вещи,
                    которых по факту нет, — без удаления они висят вечно и кладовщик каждый
                    раз идёт искать несуществующий товар. Из остальных состояний удалять
                    нельзя: вещь в работе. */}
                {isAdmin && (
                  <TableCell>
                    {(i.status === 'in_stock' || i.status === 'awaiting_shelf') && onDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Удалить со склада"
                        onClick={() => onRequestDelete(i.id)}
                      >
                        <Icon name="Trash2" size={14} className="text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
  );
};

export default GoodsWarehouseTableRow;
