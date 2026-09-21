import { RefObject, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import { mpStatusInfo } from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import CancelledItemShelfCell from './CancelledItemShelfCell';
import FbsSupplyChecklist from './FbsSupplyChecklist';
import SupplyBundleRow from './SupplyBundleRow';

interface SupplyItemsSectionProps {
  supply: SupplyDetail;
  supplyId: number;
  canEditItems: boolean;
  /** Удалять позиции из FBS-поставки может только администратор. */
  canRemoveItems?: boolean;
  readyGoods: GoodsWarehouseItem[];
  scanOrderNumber: string;
  setScanOrderNumber: (value: string) => void;
  scanning: boolean;
  scanInputRef: RefObject<HTMLInputElement>;
  onScanOrder: () => void;
  onRemoveItem: (itemId: number) => void;
  onNavigateAssemble: () => void;
  /** Перезагрузить поставку после отправки отменённого заказа на полку. */
  onReload: () => void;
}

const SupplyItemsSection = ({
  supply,
  canEditItems,
  canRemoveItems = true,
  readyGoods,
  scanOrderNumber,
  setScanOrderNumber,
  scanning,
  scanInputRef,
  onScanOrder,
  onRemoveItem,
  onNavigateAssemble,
  onReload,
}: SupplyItemsSectionProps) => {
  useScannerAutoSubmit(scanOrderNumber, onScanOrder, !scanning && supply.type === 'FBS' && canEditItems);

  // Полный список позиций у FBO по умолчанию свёрнут: в карточке главное —
  // короба, а перечень из сотен вещей нужен редко и только для разбора.
  const [listOpen, setListOpen] = useState(false);

  // Есть ли в поставке связки — от этого зависит подсказка о сканировании.
  const hasBundles = (supply.groups || []).some((g) => g.total > 1);

  // Раскладываем позиции на связки и одиночные заказы.
  //
  // Связка (Яндекс) — заказ из нескольких вещей с одним общим ярлыком: он едет
  // только целиком. Такие вещи собираем под одну строку, чтобы кладовщик видел
  // заказ, а не четыре одинаковых номера подряд. Порядок связок сохраняем по
  // первому появлению — список не должен прыгать при каждом сканировании.
  const bundles = new Map<string, typeof supply.items>();
  const singles: typeof supply.items = [];
  for (const item of supply.items) {
    const group = item.groupKey
      ? supply.groups?.find((g) => g.groupKey === item.groupKey)
      : undefined;
    // Группа из одной вещи связкой не считается: это обычный заказ.
    if (group && group.total > 1) {
      const list = bundles.get(group.groupKey) || [];
      list.push(item);
      bundles.set(group.groupKey, list);
    } else {
      singles.push(item);
    }
  }
  const rows = [...bundles.entries()].map(([key, items]) => ({
    kind: 'bundle' as const,
    group: supply.groups!.find((g) => g.groupKey === key)!,
    items,
  }));

  // Готовые вещи, которые ещё не попали в эту поставку. Сверяем по стикеру хранения:
  // это единственный признак конкретной физической вещи.
  const inSupply = new Set(
    supply.items.map((i) => i.storageBarcode).filter(Boolean) as string[],
  );
  const remaining = readyGoods.filter((g) => !inSupply.has(g.storageBarcode)).length;

  // Таблица позиций поставки. Вынесена в функцию: у FBO она лежит под
  // раскрытием (в карточке главное — короба), у остальных схем показывается
  // как раньше, сразу. Разметка одна и та же — дублировать её нельзя.
  const renderItemsTable = () => (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-primary hover:bg-primary">
            <TableHead className="text-primary-foreground">Заказ</TableHead>
            <TableHead className="text-primary-foreground">Товар</TableHead>
            <TableHead className="text-primary-foreground">Материал</TableHead>
            <TableHead className="text-primary-foreground">Размер</TableHead>
            <TableHead className="text-primary-foreground">Статус</TableHead>
            {canEditItems && <TableHead className="text-primary-foreground"></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* Связки Яндекса показываем ОДНОЙ строкой с раскрытием, а не
              вперемешку с одиночными заказами. Вещи такого заказа едут
              только целиком, и кладовщик должен видеть это сразу, а не
              вычитывать одинаковые номера в четырёх соседних строках. */}
          {rows.map((row) =>
            row.kind === 'bundle' ? (
              <SupplyBundleRow
                key={row.group.groupKey}
                group={row.group}
                items={row.items}
                supply={supply}
                canEditItems={canEditItems}
                canRemoveItems={canRemoveItems}
                onRemoveItem={onRemoveItem}
                onReload={onReload}
              />
            ) : null,
          )}
          {/* Одиночные заказы: одна вещь — одна строка, как и было. */}
          {singles.map((item) => (
            <TableRow
              key={item.id}
              className={item.isCancelled ? 'bg-destructive/10' : undefined}
            >
              <TableCell className="font-medium">
                <span className="break-all">{item.orderNumber || '—'}</span>
                {/* Замена потерянному листку закройщика: печатаем бирку с QR
                    заказа, несём в цех — и упаковщица стикерует вещь обычным
                    путём, сканируя код. */}
                {item.orderNumber && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-7 px-1.5 text-xs text-muted-foreground"
                    title="Напечатать QR-бирку заказа взамен листка закройщика"
                    onClick={async () => {
                      const { printOrderQrTag } = await import('@/lib/printOrderQrTag');
                      await printOrderQrTag({
                        orderNumber: item.orderNumber as string,
                        material: item.material,
                        width: item.width,
                        height: item.height,
                        marketplace: supply.marketplace,
                        orderType: supply.type,
                      });
                    }}
                  >
                    <Icon name="QrCode" size={14} className="mr-1" />
                    QR заказа
                  </Button>
                )}
              </TableCell>
              <TableCell>{item.product || '—'}</TableCell>
              <TableCell>{item.material || '—'}</TableCell>
              <TableCell>
                {item.width && item.height ? `${item.width}×${item.height}` : '—'}
              </TableCell>
              <TableCell>
                {item.isCancelled ? (
                  <Badge variant="destructive">ЗАКАЗ ОТМЕНЁН</Badge>
                ) : (
                  <Badge variant="outline">
                    {item.goodsStatus === 'reserved' ? 'Зарезервирован' : item.goodsStatus === 'shipped' ? 'Отгружен' : item.goodsStatus}
                  </Badge>
                )}
                {/* Статус НА ПЛОЩАДКЕ: показывает, куда движется отправление —
                    в отгрузку или в отмену. Отмену видно сразу, а не при закрытии. */}
                {(() => {
                  const mp = mpStatusInfo(item.mpStatus);
                  if (!mp || item.isCancelled) return null;
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
                  {item.isCancelled ? (
                    <CancelledItemShelfCell
                      item={item}
                      shelves={supply.shelves || []}
                      onDone={onReload}
                    />
                  ) : (
                    canRemoveItems && (
                      <Button variant="ghost" size="icon" onClick={() => onRemoveItem(item.id)}>
                        <Icon name="Trash2" size={14} />
                      </Button>
                    )
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  // ============================================================
  // FBO: КАРТОЧКА ПОКАЗЫВАЕТ КОРОБА, А НЕ ПРОСТЫНЮ ИЗ ВЕЩЕЙ.
  // ============================================================
  //
  // Раньше здесь висел плоский список всех позиций поставки — на FBO это
  // сотни строк, через которые надо было прокручивать всю страницу. При этом
  // вещь в FBO обезличена: её номер заказа кладовщику ничего не говорит, он
  // работает коробами.
  //
  // Поэтому для FBO показываем сводку по коробам: сколько уложено, сколько
  // коробов закрыто. Сам состав — внутри короба на экране сборки, где его и
  // набивают. Полный список остаётся доступен под раскрытием — он нужен
  // менеджеру для разбора, но не должен занимать экран по умолчанию.
  if (supply.type === 'FBO') {
    const boxedItems = supply.boxes.reduce((sum, b) => sum + b.items.length, 0);
    const closedBoxes = supply.boxes.filter((b) => b.closedAt).length;
    // Вещи, попавшие в поставку мимо коробов (сканирование в общий состав).
    const looseItems = supply.items.length - boxedItems;

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Сборка по коробам</h2>
          {canEditItems && (
            <Button size="sm" onClick={onNavigateAssemble}>
              <Icon name="PackagePlus" size={14} className="mr-1" />
              Собрать поставку
            </Button>
          )}
        </div>

        {supply.boxes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Коробов пока нет. Нажмите «Собрать поставку» — там создаются короба и
            сканируются вещи
          </p>
        ) : (
          <div className="space-y-2">
            {/* Плашка на каждый короб: номер, количество и состояние. Это всё,
                что нужно видеть в карточке поставки — набивают короба на
                отдельном экране сборки. */}
            {supply.boxes.map((box) => (
              <button
                key={box.id}
                type="button"
                onClick={onNavigateAssemble}
                className="flex w-full items-center gap-3 rounded-lg border border-border px-4 py-3 text-left hover:bg-muted/50"
              >
                <Icon
                  name={box.closedAt ? 'PackageCheck' : 'Package'}
                  size={18}
                  className={`shrink-0 ${
                    box.closedAt ? 'text-emerald-600' : 'text-muted-foreground'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">Короб №{box.boxNumber}</span>
                    <Badge variant={box.items.length ? 'default' : 'outline'}>
                      {box.items.length} шт.
                    </Badge>
                    {box.closedAt && (
                      <Badge variant="secondary" className="text-[10px]">Закрыт</Badge>
                    )}
                    {supply.marketplace === 'OZON' && box.closedAt && (
                      box.ozonCargoId ? (
                        <Badge className="bg-emerald-600 text-[10px] text-white hover:bg-emerald-600">
                          На OZON #{box.ozonCargoId}
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-600 text-[10px] text-white hover:bg-amber-600">
                          Не ушёл на OZON
                        </Badge>
                      )
                    )}
                  </div>
                  <p className="truncate font-mono-tech text-xs text-muted-foreground">
                    {box.barcode}
                  </p>
                </div>
                <Icon name="ChevronRight" size={16} className="shrink-0 text-muted-foreground" />
              </button>
            ))}

            <p className="text-sm text-muted-foreground">
              Всего уложено: <b>{boxedItems}</b>
              {closedBoxes > 0 && ` · закрыто коробов: ${closedBoxes} из ${supply.boxes.length}`}
              {looseItems > 0 && ` · вне коробов: ${looseItems}`}
            </p>
          </div>
        )}

        {/* Полный список позиций — под раскрытием. Менеджеру он нужен, чтобы
            разобраться с конкретной вещью, но открывать его при каждом входе
            в поставку не нужно. */}
        {supply.items.length > 0 && (
          <Collapsible open={listOpen} onOpenChange={setListOpen} className="rounded-lg border border-border">
            <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/50">
              <Icon
                name="ChevronRight"
                size={16}
                className={`shrink-0 text-muted-foreground transition-transform ${
                  listOpen ? 'rotate-90' : ''
                }`}
              />
              <span className="font-semibold">Все товары поставки ({supply.items.length})</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-t border-border p-4">{renderItemsTable()}</div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {supply.type === 'FBS' ? (
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {/* Сколько товара ждёт отгрузки на маркетплейсе: прошло конвейер или
                снято с полок, застикеровано, но ещё не отсканировано ни в одну
                поставку. Это и есть объём работы кладовщика.
                Не успел отсканировать всё — остаток сам попадёт в счётчик
                следующей поставки, как только её создадут. */}
            <span>
              Ожидают отгрузки: <b>{supply.awaitingShipCount ?? readyGoods.length}</b>
            </span>
            <span>
              Добавлено товаров: <b>{supply.items.length}</b>
            </span>
            {/* Главное число для кладовщика: сколько ещё нести и пикать. Без него он
                считал разницу в уме и не понимал, когда поставка собрана полностью. */}
            {remaining > 0 ? (
              <span className="rounded-full bg-amber-100 px-3 py-0.5 font-semibold text-amber-900">
                Осталось отсканировать: {remaining}
              </span>
            ) : (
              readyGoods.length > 0 && (
                <span className="rounded-full bg-emerald-100 px-3 py-0.5 font-semibold text-emerald-800">
                  Всё отсканировано
                </span>
              )
            )}
          </div>
        ) : (
          <h2 className="font-semibold">Товары в поставке ({supply.items.length})</h2>
        )}
        {/* Кнопки «Собрать поставку» здесь больше нет: FBO уходит в свою ветку
            выше, со сводкой по коробам, и до этого места не доходит. */}
      </div>

      {canEditItems && supply.type === 'FBS' && (
        <Card className="border-primary/30 bg-primary/5 shadow-none">
          <CardContent
            className="space-y-2 pt-6"
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest('input, button, a')) {
                scanInputRef.current?.focus();
              }
            }}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Icon name="ScanLine" size={18} />
              Сканируйте пакет с товаром — ярлык маркетплейса на нём
            </div>
            {/* У связки Яндекса ярлык маркетплейса ОДИН на все вещи: на каждой
                наклейке один и тот же номер и «1/1». Разложить им вещи по одной
                нельзя, поэтому связку собирают по нашему складскому стикеру. */}
            {hasBundles && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                <Icon name="Package" size={14} className="mt-0.5 shrink-0" />
                <span>
                  В поставке есть связки: у них ярлык маркетплейса один на все вещи.
                  Такие вещи сканируйте по <b>стикеру связки</b> (YM-…) — каждую
                  отдельно, пока связка не соберётся целиком
                </span>
              </div>
            )}
            <div className="flex gap-2">
              <Input
                ref={scanInputRef}
                autoFocus
                placeholder="Номер отправления с ярлыка маркетплейса"
                value={scanOrderNumber}
                onChange={(e) => setScanOrderNumber(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onScanOrder()}
                disabled={scanning}
                className="font-mono-tech"
              />
              <Button onClick={onScanOrder} disabled={scanning || !scanOrderNumber.trim()}>
                {scanning ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Добавить товар'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* FBS собирают по чек-листу: одним списком и то, что уже отсканировано, и то,
          что осталось принести со склада. Кладовщик пикает ярлык — строка зеленеет.
          Раньше здесь было только число «осталось отсканировать», и перечень товара
          приходилось держать в голове или искать в соседней вкладке. */}
      {supply.type === 'FBS' ? (
        <FbsSupplyChecklist
          supply={supply}
          canEditItems={canEditItems}
          canRemoveItems={canRemoveItems}
          onRemoveItem={onRemoveItem}
          onReload={onReload}
        />
      ) : supply.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">В поставке пока нет товаров</p>
      ) : (
        renderItemsTable()
      )}
    </div>
  );
};

export default SupplyItemsSection;