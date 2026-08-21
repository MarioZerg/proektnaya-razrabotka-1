import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import Icon from '@/components/ui/icon';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PriceAdvice, PriceAction } from '@/lib/promotionApi';

interface Props {
  items: PriceAdvice[];
  selected: Set<number>;
  onToggle: (itemId: number) => void;
  onToggleAll: () => void;
}

const money = (v: number) =>
  v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });

/** Как выглядит каждый совет: цвет и подпись понятны без объяснений. */
const ACTION_STYLE: Record<PriceAction, { label: string; className: string; icon: string }> = {
  raise: {
    label: 'Поднять',
    className: 'bg-emerald-100 text-emerald-900 hover:bg-emerald-100',
    icon: 'TrendingUp',
  },
  lower: {
    label: 'Снизить',
    className: 'bg-amber-100 text-amber-900 hover:bg-amber-100',
    icon: 'TrendingDown',
  },
  rollback: {
    label: 'Откатить',
    className: 'bg-destructive/10 text-destructive hover:bg-destructive/10',
    icon: 'Undo2',
  },
  hold: {
    label: 'Всё хорошо',
    className: 'bg-muted text-muted-foreground hover:bg-muted',
    icon: 'Check',
  },
  wait: {
    label: 'Ждём',
    className: 'bg-sky-100 text-sky-900 hover:bg-sky-100',
    icon: 'Clock',
  },
};

/**
 * Советы по ценам.
 *
 * Показываем только то, где нужно действие: позиции «всё хорошо» и «ждём» в
 * таблицу не попадают — они лишь отвлекают. Их число видно в сводке выше.
 */
const PriceAdviceTable = ({ items, selected, onToggle, onToggleAll }: Props) => {
  const actionable = items.filter(
    (i) => i.action === 'raise' || i.action === 'lower' || i.action === 'rollback',
  );

  if (actionable.length === 0) {
    return (
      <div className="rounded-lg border border-border p-8 text-center">
        <Icon name="CircleCheck" size={28} className="mx-auto text-emerald-600" />
        <p className="mt-2 font-medium">Менять нечего</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Все позиции в целевом коридоре маржи или ждут паузы после прошлого шага
        </p>
      </div>
    );
  }

  const allChecked = actionable.every((i) => selected.has(i.itemId));

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[44px]">
              <Checkbox checked={allChecked} onCheckedChange={onToggleAll} />
            </TableHead>
            <TableHead>Размер</TableHead>
            <TableHead className="w-[130px]">Что делаем</TableHead>
            <TableHead className="w-[150px]">Цена</TableHead>
            <TableHead className="w-[120px]">Маржа</TableHead>
            <TableHead className="w-[110px]">Реклама</TableHead>
            <TableHead className="w-[90px]">СПП</TableHead>
            <TableHead>Почему</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {actionable.map((i) => {
            const style = ACTION_STYLE[i.action];
            const diff = i.suggestedPrice - i.currentPrice;
            // Убыточен только из-за рекламы: без неё был бы в плюсе.
            const adKills =
              i.currentMargin < 0 && (i.marginWithoutAd ?? 0) > 0;
            return (
              <TableRow key={i.itemId}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(i.itemId)}
                    onCheckedChange={() => onToggle(i.itemId)}
                  />
                </TableCell>
                <TableCell>
                  <div className="font-medium leading-tight">{i.title}</div>
                  {i.sku && (
                    <div className="font-mono-tech text-xs text-muted-foreground">
                      {i.sku}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge className={style.className} variant="secondary">
                    <Icon name={style.icon} size={12} className="mr-1" />
                    {style.label}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground">{money(i.currentPrice)}</span>
                  <Icon name="ArrowRight" size={12} className="mx-1 inline" />
                  <span className="font-semibold">{money(i.suggestedPrice)} ₽</span>
                  <div
                    className={`text-xs ${diff > 0 ? 'text-emerald-700' : 'text-amber-700'}`}
                  >
                    {diff > 0 ? '+' : ''}
                    {money(diff)} ₽
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground">{i.currentMargin}%</span>
                  {i.expectedMargin != null && (
                    <>
                      <Icon name="ArrowRight" size={12} className="mx-1 inline" />
                      <span className="font-semibold">{i.expectedMargin}%</span>
                    </>
                  )}
                </TableCell>
                <TableCell>
                  {i.adPercent ? (
                    <>
                      <div className="text-sm font-medium">−{i.adPercent}%</div>
                      {/* Товар прибыльный сам по себе, но реклама съедает
                          больше, чем он приносит. Поднимать цену бесполезно —
                          надо выключать бустинг. */}
                      {adKills && (
                        <div className="text-[11px] leading-tight text-destructive">
                          без неё {i.marginWithoutAd}%
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">не крутим</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {i.spp != null ? (
                    `${i.spp}%`
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {i.reason}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default PriceAdviceTable;