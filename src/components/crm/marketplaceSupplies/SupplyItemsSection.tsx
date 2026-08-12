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
            {/* Сколько вещей для ЭТОЙ поставки собрано и отстикеровано на складе. */}
            <span>
              Готово к сборке: <b>{readyGoods.length}</b>
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

      {/* Список товаров с полок здесь НЕ показываем: сборка ведётся на складе товара.
          Кладовщик находит вещь на полке, сканирует и стикерует её там, и только потом
          приходит сюда и сканирует в поставку. Дублирующий список сбивал порядок работы. */}
      {supply.type === 'FBS' && readyGoods.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Нет собранных товаров. Найдите и отстикеруйте их на складе в разделе
          «Сборка товара с полок», потом отсканируйте сюда
        </p>
      )}

      {supply.type === 'FBS' && (
        <h3 className="pt-2 text-sm font-semibold">Добавлено в поставку ({supply.items.length})</h3>
      )}

      {supply.items.length === 0 ? (
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
              {supply.items.map((item) => {
                // Связка этого товара: полностью собранные подсвечиваем зелёным, неполные —
                // жёлтым, чтобы кладовщик прямо в списке видел, что ещё нужно донести.
                const group = item.groupKey
                  ? supply.groups?.find((g) => g.groupKey === item.groupKey)
                  : undefined;
                return (
                <TableRow
                  key={item.id}
                  className={
                    item.isCancelled
                      ? 'bg-destructive/10'
                      : group && !group.isComplete
                        ? 'bg-amber-50'
                        : undefined
                  }
                >
                  <TableCell className="font-medium">
                    <span className="break-all">{item.orderNumber || '—'}</span>
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
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default SupplyItemsSection;