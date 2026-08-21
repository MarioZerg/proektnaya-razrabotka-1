import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { SupplyDetail, SupplyGroup, SupplyItem } from '@/lib/marketplaceSuppliesApi';
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
  /** Стикер связки (YM-…) — им сканируют вещь в поставку. */
  bundleBarcode?: string | null;
  item?: SupplyItem;
  /** Связка Яндекса: строки с одним ключом показываются под общей шапкой. */
  groupKey?: string | null;
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
    groupKey: item.groupKey ?? null,
    bundleBarcode: item.bundleBarcode ?? null,
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
    groupKey: a.groupKey ?? null,
    bundleBarcode: a.bundleBarcode ?? null,
  }));

  // Ненайденные — НАВЕРХ. Это и есть работа: собранное кладовщик уже держит в коробе
  // и перечитывать не будет. Раньше список шёл в обратном порядке, и три несобранные
  // вещи прятались в самом низу под полутора сотней зелёных строк — до них нужно было
  // домотать, и казалось, что их вообще нет.
  const flatRows = [...waitingRows, ...scannedRows];
  const total = flatRows.length;

  // Связки Яндекса собираем вместе: вещи одного заказа едут только целиком, и
  // кладовщик должен видеть их подряд под общей шапкой, а не искать по всему
  // списку одинаковые номера. Порядок сохраняем: связка встаёт туда, где стояла
  // её первая вещь — несобранное по-прежнему сверху.
  const groupOf = (r: Row) =>
    r.groupKey ? supply.groups?.find((g) => g.groupKey === r.groupKey) : undefined;

  type Block =
    | { kind: 'row'; row: Row }
    | { kind: 'bundle'; group: SupplyGroup; rows: Row[] };

  const blocks: Block[] = [];
  const seen = new Set<string>();
  for (const row of flatRows) {
    const group = groupOf(row);
    // Группа из одной вещи связкой не считается — это обычный заказ.
    if (!group || group.total <= 1) {
      blocks.push({ kind: 'row', row });
      continue;
    }
    if (seen.has(group.groupKey)) continue;
    seen.add(group.groupKey);
    blocks.push({
      kind: 'bundle',
      group,
      rows: flatRows.filter((r) => r.groupKey === group.groupKey),
    });
  }

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

  /**
   * Печать стикера связки (YM-…).
   *
   * Связку собирают именно по нему: ярлык маркетплейса у заказа из нескольких
   * вещей один на всех, и отсканировать им четыре разные вещи невозможно.
   * Стикер на складе мнётся и отклеивается — тогда вещь не отсканировать вовсе,
   * поэтому даём напечатать его заново.
   */
  const handlePrintBundle = async (row: Row) => {
    if (!row.bundleBarcode) return;
    const { printStorageSticker } = await import('@/lib/printStorageSticker');
    const group = row.groupKey
      ? supply.groups?.find((g) => g.groupKey === row.groupKey)
      : undefined;
    printStorageSticker({
      storageBarcode: row.bundleBarcode,
      title: `${row.material || ''} ${row.width && row.height ? `${row.width}×${row.height}` : ''}`.trim(),
      orderNumber: row.orderNumber,
      groupLabel: group && group.total > 1 ? `Связка: вещь из ${group.total}` : null,
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

  // Одна строка списка. Вынесена в функцию, чтобы те же строки можно было
  // показать и внутри связки, не дублируя разметку.
  const renderRow = (row: Row) => {
    const item = row.item;
    // Связка вещи нужна только для подсветки строки: сама метка живёт в шапке.
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
                        onClick={() => void handlePrintQr(row)}
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
                        onClick={() => void handlePrintBundle(row)}
                      >
                        <Icon name="Barcode" size={14} className="mr-1" />
                        Стикер {row.bundleBarcode}
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
  };

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
            {/* Связки Яндекса идут под общей шапкой: вещи такого заказа едут
                только целиком, и кладовщик должен видеть их вместе, а не
                выискивать одинаковые номера по всему списку. */}
            {blocks.map((block) =>
              block.kind === 'bundle' ? (
                <BundleBlock
                  key={block.group.groupKey}
                  group={block.group}
                  rows={block.rows}
                  renderRow={renderRow}
                  colSpan={canEditItems ? 7 : 6}
                  supplyId={supply.id}
                  onLabelScanned={onReload}
                />
              ) : (
                renderRow(block.row)
              ),
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};


/**
 * Шапка связки и её вещи под ней.
 *
 * Связка — заказ покупателя из нескольких вещей с одним общим ярлыком (Яндекс).
 * Отгрузить половину нельзя: остаток застрянет на складе, а покупателю уедет
 * неполная посылка. Поэтому вещи показываем не вперемешку с одиночными
 * заказами, а одной группой со счётчиком «3 из 4».
 *
 * Неполные связки раскрыты сразу — по ним есть работа. Собранные свёрнуты:
 * кладовщик к ним уже не вернётся.
 */
const BundleBlock = ({
  group,
  rows,
  renderRow,
  colSpan,
  supplyId,
  onLabelScanned,
}: {
  group: SupplyGroup;
  rows: Row[];
  renderRow: (row: Row) => JSX.Element;
  colSpan: number;
  supplyId: number;
  onLabelScanned: () => void;
}) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(!group.isComplete);
  const [labelCode, setLabelCode] = useState('');
  const [savingLabel, setSavingLabel] = useState(false);
  const short = group.total - group.inSupply;

  // Второй шаг: общий ярлык маркетплейса на коробку. Открывается, только когда
  // все вещи связки собраны — иначе коробку заклеят с неполным заказом.
  const submitLabel = async () => {
    setSavingLabel(true);
    try {
      const { scanBundleLabel } = await import('@/lib/marketplaceSuppliesApi');
      await scanBundleLabel(supplyId, group.groupKey, labelCode.trim(), user?.id, user?.name);
      toast({
        title: 'Ярлык подтверждён',
        description: 'Наклейте его на коробку со связкой',
      });
      setLabelCode('');
      onLabelScanned();
    } catch (e) {
      toast({
        title: 'Не удалось подтвердить ярлык',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSavingLabel(false);
    }
  };

  return (
    <>
      <TableRow
        className={`cursor-pointer ${
          group.isComplete ? 'bg-emerald-100/70' : 'bg-amber-100/70'
        } hover:bg-muted`}
        onClick={() => setOpen((v) => !v)}
      >
        <TableCell colSpan={colSpan} className="py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Icon
              name={open ? 'ChevronDown' : 'ChevronRight'}
              size={16}
              className="shrink-0 text-muted-foreground"
            />
            <Icon name="Package" size={15} className="shrink-0" />
            <span className="font-semibold">Связка</span>
            <span className="break-all font-mono-tech text-sm">{group.groupKey}</span>
            <Badge
              className={`px-1.5 py-0 text-[11px] text-white ${
                group.isComplete
                  ? 'bg-emerald-600 hover:bg-emerald-600'
                  : 'bg-amber-600 hover:bg-amber-600'
              }`}
            >
              {group.inSupply} из {group.total}
            </Badge>
            {!group.isComplete && (
              <span className="text-xs font-medium text-amber-800">
                нужно донести ещё {short} — заказ едет только целиком
              </span>
            )}
            {group.isComplete && group.labelScanned && (
              <span className="flex items-center gap-1 text-xs text-emerald-700">
                <Icon name="CircleCheck" size={13} />
                ярлык наклеен — можно отгружать
              </span>
            )}
            {group.isComplete && !group.labelScanned && (
              <span className="text-xs font-medium text-amber-800">
                вещи собраны — осталось наклеить общий ярлык
              </span>
            )}
            <span className="ml-auto text-xs text-muted-foreground">
              {open ? 'свернуть' : 'показать товары'}
            </span>
          </div>
        </TableCell>
      </TableRow>

      {/* ВТОРОЙ ШАГ. Вещи собраны — теперь общий ярлык маркетплейса на коробку.
          Он у связки один на весь заказ: кладовщик сканирует его один раз и
          клеит на коробку. Пока не подтверждён, поставку не отгрузить. */}
      {group.isComplete && !group.labelScanned && (
        <TableRow className="bg-amber-50">
          <TableCell colSpan={colSpan} className="py-2">
            <div
              className="flex flex-wrap items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <Icon name="ScanLine" size={16} className="shrink-0 text-amber-700" />
              <span className="text-sm font-medium text-amber-900">
                Шаг 2: отсканируйте общий ярлык заказа и наклейте его на коробку
              </span>
              <Input
                value={labelCode}
                onChange={(e) => setLabelCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && labelCode.trim() && void submitLabel()}
                placeholder="Номер с ярлыка маркетплейса"
                className="h-8 w-56 font-mono-tech text-sm"
                disabled={savingLabel}
              />
              <Button
                size="sm"
                onClick={() => void submitLabel()}
                disabled={savingLabel || !labelCode.trim()}
              >
                {savingLabel ? (
                  <Icon name="Loader2" size={14} className="mr-1 animate-spin" />
                ) : (
                  <Icon name="Check" size={14} className="mr-1" />
                )}
                Ярлык наклеен
              </Button>
            </div>
          </TableCell>
        </TableRow>
      )}

      {open && rows.map(renderRow)}
    </>
  );
};

export default FbsSupplyChecklist;
