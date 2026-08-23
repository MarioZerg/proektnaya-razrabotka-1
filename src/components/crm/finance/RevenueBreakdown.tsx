import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';

/**
 * Куда ушла выручка.
 *
 * «Заработали 2 млн с оборота 72 млн» — цифра без объяснения: непонятно, что
 * съело остальное и на что вообще можно повлиять. Здесь видно каждую статью:
 * почти половину забирает комиссия площадки, пятую часть — производство,
 * десятую — реклама.
 *
 * Расходы разложены по долям от цены, поэтому картина верна и для товаров,
 * проданных в акции со скидкой.
 */
interface Props {
  revenue: number;
  profit: number;
  margin: number;
  breakdown: Record<string, number>;
}

/** Человеческие названия статей и цвет полосы. */
const PARTS: { key: string; label: string; color: string }[] = [
  { key: 'commission', label: 'Комиссия площадки', color: 'bg-rose-500' },
  { key: 'production', label: 'Себестоимость', color: 'bg-amber-500' },
  { key: 'promo', label: 'Реклама и продвижение', color: 'bg-orange-400' },
  { key: 'tax', label: 'Налог УСН', color: 'bg-slate-500' },
  { key: 'vat', label: 'НДС', color: 'bg-slate-400' },
  { key: 'logistics', label: 'Логистика', color: 'bg-sky-500' },
  { key: 'returnCost', label: 'Возвраты и невыкупы', color: 'bg-violet-400' },
  { key: 'acquiring', label: 'Эквайринг', color: 'bg-teal-500' },
  { key: 'storage', label: 'Хранение', color: 'bg-cyan-500' },
  { key: 'acceptance', label: 'Приёмка', color: 'bg-lime-500' },
];

const money = (v: number) =>
  Math.round(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 });

const RevenueBreakdown = ({ revenue, profit, margin, breakdown }: Props) => {
  if (!revenue) return null;

  const rows = PARTS.map((p) => ({
    ...p,
    value: breakdown[p.key] || 0,
    percent: ((breakdown[p.key] || 0) / revenue) * 100,
  }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);

  const spent = rows.reduce((a, r) => a + r.value, 0);

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Icon name="PieChart" size={15} />
            Куда ушла выручка
          </p>
          <p className="text-xs text-muted-foreground">
            с оборота {money(revenue)} ₽
          </p>
        </div>

        {/* Полоса целиком: каждая статья своим куском, прибыль в конце.
            Сразу видно, что почти всё съедают комиссия и производство. */}
        <div className="flex h-3 overflow-hidden rounded-full bg-muted">
          {rows.map((r) => (
            <div
              key={r.key}
              className={r.color}
              style={{ width: `${r.percent}%` }}
              title={`${r.label}: ${money(r.value)} ₽`}
            />
          ))}
          {profit > 0 && (
            <div
              className="bg-emerald-600"
              style={{ width: `${(profit / revenue) * 100}%` }}
              title={`Остаётся нам: ${money(profit)} ₽`}
            />
          )}
        </div>

        <div className="space-y-1">
          {rows.map((r) => (
            <div
              key={r.key}
              className="flex items-center gap-2 text-xs"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${r.color}`} />
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {r.percent.toFixed(1)}%
              </span>
              <span className="w-28 shrink-0 text-right font-medium tabular-nums">
                {money(r.value)} ₽
              </span>
            </div>
          ))}

          <div className="flex items-center gap-2 border-t border-border pt-1 text-xs">
            <span className="h-2 w-2 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              Всего вычетов
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {((spent / revenue) * 100).toFixed(1)}%
            </span>
            <span className="w-28 shrink-0 text-right font-medium tabular-nums text-muted-foreground">
              −{money(spent)} ₽
            </span>
          </div>

          {/* Чистая прибыль — то, ради чего всё считалось. */}
          <div className="flex items-center gap-2 border-t border-border pt-1 text-sm">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
            <span className="min-w-0 flex-1 font-medium">Остаётся нам</span>
            <span className="shrink-0 font-bold tabular-nums">{margin}%</span>
            <span
              className={`w-28 shrink-0 text-right font-bold tabular-nums ${
                profit > 0 ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              {profit > 0 ? '+' : ''}
              {money(profit)} ₽
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default RevenueBreakdown;
