import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { BoughtOrder } from '@/lib/managerFinanceApi';
import { MP, fullDate, money } from './buyoutsShared';

/**
 * Лента выкупленных заказов: что купили, почём и сколько на этом заработали.
 *
 * Телефон: шесть колонок в строку не помещаются — показываем то же самое
 * карточками. На компьютере остаётся обычная таблица.
 */
interface Props {
  items: BoughtOrder[];
  loading: boolean;
}

/** Прибыль с вещи: зелёным, если заработали, красным — если ушли в минус. */
const marginCell = (o: BoughtOrder) => {
  if (o.margin === null || o.margin === undefined) {
    return <span className="text-muted-foreground">—</span>;
  }
  const good = o.margin > 0;
  return (
    <span
      className={`font-medium ${good ? 'text-emerald-700' : 'text-rose-700'}`}
    >
      {o.profit !== null && o.profit !== undefined && (
        <>
          {good ? '+' : ''}
          {money(o.profit)} ₽{' '}
        </>
      )}
      <span className="text-xs">({o.margin}%)</span>
    </span>
  );
};

const BuyoutsList = ({ items, loading }: Props) => (
  <>
    {loading && (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загружаем…
      </div>
    )}

    {!loading && items.length === 0 && (
      <p className="text-sm text-muted-foreground">
        Выкупленных заказов пока нет
      </p>
    )}

    {/* Телефон: шесть колонок в строку не помещаются — показываем то же
        самое карточками. На компьютере остаётся обычная таблица. */}
    {!loading && items.length > 0 && (
      <>
        <div className="space-y-2 md:hidden">
          {items.map((o) => (
            <div
              key={o.id}
              className="rounded-md border border-border bg-card p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {o.material || 'Без ткани'}{' '}
                    <span className="text-muted-foreground">
                      {o.width}×{o.height}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className={MP[o.marketplace]?.className}>
                      {MP[o.marketplace]?.label || o.marketplace}
                    </span>
                    {o.scheme ? ` · ${o.scheme}` : ''} · {fullDate(o.soldAt)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-base font-bold">{money(o.price)} ₽</p>
                  {!!o.cardPrice && !!o.price && o.cardPrice > o.price && (
                    <p className="text-[11px] text-muted-foreground">
                      СПП {money(o.cardPrice - o.price)} ₽
                    </p>
                  )}
                </div>
              </div>
              <p className="mt-1.5 border-t border-border pt-1.5 text-sm">
                {marginCell(o)}
              </p>
            </div>
          ))}
        </div>

        <div className="hidden overflow-x-auto rounded-md border border-border md:block">
          <Table>
            <TableHeader>
              <TableRow className="bg-primary hover:bg-primary">
                <TableHead className="text-primary-foreground">Товар</TableHead>
                <TableHead className="text-primary-foreground">
                  Размер
                </TableHead>
                <TableHead className="text-primary-foreground">
                  Площадка
                </TableHead>
                <TableHead className="text-primary-foreground">
                  Выкуплен
                </TableHead>
                <TableHead className="text-right text-primary-foreground">
                  Заплатил покупатель
                </TableHead>
                <TableHead className="text-right text-primary-foreground">
                  Заработали
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="font-medium">
                    {o.material || 'Без ткани'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {o.width}×{o.height}
                  </TableCell>
                  <TableCell>
                    <span className={MP[o.marketplace]?.className}>
                      {MP[o.marketplace]?.label || o.marketplace}
                    </span>
                    {o.scheme && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        {o.scheme}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {fullDate(o.soldAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <span className="font-bold">{money(o.price)} ₽</span>
                    {/* СПП: площадка возмещает скидку продавцу, поэтому
                        начислено меньше цены карточки. Без этой строки
                        цифра выглядит необъяснимо заниженной. */}
                    {!!o.cardPrice && !!o.price && o.cardPrice > o.price && (
                      <span className="block text-[11px] text-muted-foreground">
                        <span className="line-through">
                          {money(o.cardPrice)}
                        </span>{' '}
                        · СПП {money(o.cardPrice - o.price)} ₽
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {marginCell(o)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </>
    )}
  </>
);

export default BuyoutsList;
