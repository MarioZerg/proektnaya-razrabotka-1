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
  /** Оплачено баллами Ozon — справочно: это часть цены, а не доход. */
  bonus?: { points: number; bank: number };
}

/** Человеческие названия статей и цвет полосы. */
const PARTS: { key: string; label: string; hint?: string; color: string }[] = [
  {
    key: 'commission',
    label: 'Удержание площадки',
    // Площадка снимает всё одной строкой — отдельно логистику и эквайринг
    // вычитать нельзя, иначе они посчитаются дважды.
    hint: 'комиссия, логистика, обработка, эквайринг',
    color: 'bg-rose-500',
  },
  { key: 'production', label: 'Себестоимость', color: 'bg-amber-500' },
  {
    key: 'promo',
    label: 'Реклама и продвижение',
    hint: 'по факту из кабинета',
    color: 'bg-orange-400',
  },
  {
    key: 'returns',
    label: 'Потери на возвратах',
    // Вещь вернулась, деньги покупателю отданы, а ткань и работа потрачены.
    hint: 'ткань и работа по вернувшимся вещам',
    color: 'bg-red-700',
  },
  { key: 'tax', label: 'Налог УСН', color: 'bg-slate-500' },
  { key: 'vat', label: 'НДС', color: 'bg-slate-400' },
  { key: 'acquiring', label: 'Приём платежа', color: 'bg-cyan-600' },
  {
    key: 'fees',
    label: 'Услуги площадки',
    // Подписку Premium сюда НЕ берём: она уже сидит в себестоимости вещи,
    // иначе одни и те же 50 000 ₽ вычитались бы дважды.
    hint: 'слоты, страхование, упаковка — без подписки',
    color: 'bg-violet-400',
  },
];

const money = (v: number) =>
  Math.round(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 });

const RevenueBreakdown = ({
  revenue,
  profit,
  margin,
  breakdown,
  bonus,
}: Props) => {
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

        {/* БАЛЛЫ — не расход, а часть выручки.
            Покупатель гасит часть цены баллами Ozon, а площадка возмещает
            эту часть продавцу. По июлю — половина оборота, и без этой
            строки непонятно, почему деньгами пришло вдвое меньше. */}
        {/* БАЛЛЫ — СПОСОБ ОПЛАТЫ, А НЕ ДОХОД.
            Покупатель платит одну и ту же цену, просто часть баллами Ozon.
            Вознаграждение площадки берётся от полной цены, поэтому баллы не
            добавляются к прибыли и не гасят наши расходы — они уже внутри
            выручки. Показываем справочно: видно, какая доля оборота
            приходит не деньгами. */}
        {!!bonus && bonus.points > 0 && (
          <div className="rounded-md bg-muted/60 p-2 text-xs">
            <p className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Icon name="Coins" size={13} />
                Из оборота оплачено баллами Ozon
              </span>
              <span className="font-medium">
                {money(bonus.points + bonus.bank)} ₽
              </span>
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {(((bonus.points + bonus.bank) / revenue) * 100).toFixed(0)}%
              оборота — это способ оплаты, а не отдельный доход: цена та же,
              вознаграждение площадки берётся с неё целиком
            </p>
          </div>
        )}

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
              <span className="min-w-0 flex-1 truncate">
                {r.label}
                {r.hint && (
                  <span className="ml-1 text-muted-foreground">· {r.hint}</span>
                )}
              </span>
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
