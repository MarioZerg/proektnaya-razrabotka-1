import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { catalogTitle, formatRub, raisedPrice } from '@/components/crm/promotion/raiseShared';
import type { CatalogItem } from '@/lib/priceRobotApi';

interface Props {
  items: CatalogItem[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  stepPercent: number;
  disabled: boolean;
  showShop: boolean;
}

/**
 * Список карточек, которые попадут в подъём.
 *
 * Фильтр по ткани и ширине ещё не гарантирует, что владелец поднял то, что
 * хотел: в одной ткани десятки размеров. Здесь каждую строку можно снять,
 * а рядом видно, какой станет цена после шага.
 */
const RobotRaiseTable = ({
  items,
  selected,
  onToggle,
  onToggleAll,
  stepPercent,
  disabled,
  showShop,
}: Props) => {
  const allOn = items.length > 0 && items.every((i) => selected.has(i.itemId));
  const someOn = items.some((i) => selected.has(i.itemId));

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
        Под фильтр ничего не попало. Снимите ширину или ткань — или поищите
        другое название.
      </p>
    );
  }

  return (
    <div className="max-h-[420px] overflow-auto rounded-md border border-border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allOn ? true : someOn ? 'indeterminate' : false}
                onCheckedChange={onToggleAll}
                disabled={disabled}
                aria-label="Выбрать все видимые"
              />
            </TableHead>
            <TableHead>Товар</TableHead>
            {showShop && <TableHead>Магазин</TableHead>}
            <TableHead className="text-right">Сейчас</TableHead>
            <TableHead className="text-right">Станет</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const next = stepPercent > 0 ? raisedPrice(item.price, stepPercent) : item.price;
            return (
              <TableRow
                key={item.itemId}
                className="cursor-pointer"
                onClick={() => !disabled && onToggle(item.itemId)}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(item.itemId)}
                    onCheckedChange={() => onToggle(item.itemId)}
                    disabled={disabled}
                    aria-label={catalogTitle(item)}
                  />
                </TableCell>
                <TableCell>
                  <p className="font-medium">{catalogTitle(item)}</p>
                  {item.sku && (
                    <p className="text-xs text-muted-foreground">{item.sku}</p>
                  )}
                </TableCell>
                {showShop && (
                  <TableCell className="text-muted-foreground">
                    {item.shopName || '—'}
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums">
                  {formatRub(item.price)}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {stepPercent > 0 ? formatRub(next) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default RobotRaiseTable;
