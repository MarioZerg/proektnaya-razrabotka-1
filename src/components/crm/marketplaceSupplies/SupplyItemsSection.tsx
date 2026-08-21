import { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
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
        {canEditItems && supply.type === 'FBO' && (
          <Button size="sm" onClick={onNavigateAssemble}>
            <Icon name="PackagePlus" size={14} className="mr-1" />
            Собрать поставку
          </Button>
        )}
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
      )}
    </div>
  );
};

export default SupplyItemsSection;