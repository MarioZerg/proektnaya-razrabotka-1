import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import { mpStatusInfo } from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';
import CancelledItemShelfCell from './CancelledItemShelfCell';

type Item = SupplyDetail['items'][number];
type Group = NonNullable<SupplyDetail['groups']>[number];

interface Props {
  group: Group;
  items: Item[];
  supply: SupplyDetail;
  canEditItems: boolean;
  canRemoveItems?: boolean;
  onRemoveItem: (itemId: number) => void;
  onReload: () => void;
}

/**
 * Связка Яндекса — ОДНА строка в списке поставки вместо нескольких.
 *
 * Покупатель заказал несколько вещей, и ярлык на них один общий: отгрузить
 * половину такого заказа нельзя — остаток застрянет на складе, а покупателю
 * уедет неполная посылка.
 *
 * Раньше вещи связки лежали в списке вперемешку с одиночными заказами, каждая
 * отдельной строкой. Кладовщик видел четыре похожие строки и не понимал, что
 * это один заказ, который едет только целиком. Теперь связка — одна строка со
 * счётчиком «3 из 4»; нажал — раскрылись сами вещи.
 */
const SupplyBundleRow = ({
  group,
  items,
  supply,
  canEditItems,
  canRemoveItems,
  onRemoveItem,
  onReload,
}: Props) => {
  // Неполные связки открыты сразу: по ним есть работа, и прятать её незачем.
  const [open, setOpen] = useState(!group.isComplete);

  const colSpan = canEditItems ? 6 : 5;
  const cancelled = items.filter((i) => i.isCancelled).length;
  const short = group.total - group.inSupply;

  return (
    <>
      <TableRow
        className={`cursor-pointer ${
          group.isComplete ? 'bg-emerald-50/60' : 'bg-amber-50'
        } hover:bg-muted/50`}
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

            {group.isComplete ? (
              <span className="text-xs text-emerald-700">
                собрана целиком — можно отгружать
              </span>
            ) : (
              <span className="text-xs font-medium text-amber-800">
                нужно донести ещё {short} — заказ едет только целиком
              </span>
            )}

            {cancelled > 0 && (
              <Badge variant="destructive" className="text-[10px]">
                отменено: {cancelled}
              </Badge>
            )}

            <span className="ml-auto text-xs text-muted-foreground">
              {open ? 'свернуть' : 'показать товары'}
            </span>
          </div>
        </TableCell>
      </TableRow>

      {open &&
        items.map((item) => {
          const mp = mpStatusInfo(item.mpStatus);
          return (
            <TableRow
              key={item.id}
              className={item.isCancelled ? 'bg-destructive/10' : 'bg-muted/20'}
            >
              <TableCell className="font-medium">
                {/* Отступ и полоска слева: видно, что вещь принадлежит связке
                    выше, а не лежит в поставке сама по себе. */}
                <div className="flex items-start gap-2 pl-3">
                  <span className="mt-1 h-4 w-0.5 shrink-0 rounded bg-border" />
                  <span className="break-all">{item.orderNumber || '—'}</span>
                </div>
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
                    {item.goodsStatus === 'reserved'
                      ? 'Зарезервирован'
                      : item.goodsStatus === 'shipped'
                        ? 'Отгружен'
                        : item.goodsStatus}
                  </Badge>
                )}
                {mp && !item.isCancelled && (
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
                )}
              </TableCell>
              {canEditItems && (
                <TableCell>
                  {item.isCancelled ? (
                    <CancelledItemShelfCell
                      item={item}
                      shelves={supply.shelves || []}
                      onDone={onReload}
                    />
                  ) : (
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
    </>
  );
};

export default SupplyBundleRow;
