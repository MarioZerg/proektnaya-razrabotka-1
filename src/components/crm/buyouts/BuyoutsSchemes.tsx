import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import { money, type BuyoutsScheme } from './buyoutsShared';

/**
 * FBO и FBS рядом: где мы зарабатываем, а где почти работаем в ноль.
 *
 * Со склада площадки (FBO) она удерживает 42%, со своего склада (FBS) — 47%:
 * доставку в этом случае делает тоже она, и берёт за это отдельно. Разница
 * в пять пунктов удержания превращается в разницу маржи почти вдвое.
 *
 * Обе схемы показываем одновременно и при выбранном срезе: выбрав FBS,
 * человек как раз и хочет видеть, насколько он хуже FBO.
 */
interface Props {
  schemes: BuyoutsScheme[];
  /** Выбранная схема — её карточка подсвечена. */
  active: string;
  onSelect: (scheme: string) => void;
}

/** Что означает схема — словами, а не сокращением. */
const HINT: Record<string, string> = {
  FBO: 'со склада площадки',
  FBS: 'со своего склада',
};

const BuyoutsSchemes = ({ schemes, active, onSelect }: Props) => {
  const rows = schemes.filter((s) => s.revenue > 0);
  if (rows.length < 2) return null;

  // Лучшая схема по марже — с ней сравниваем остальные.
  const best = rows.reduce((a, b) => (b.margin > a.margin ? b : a));

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((s) => {
        const isActive = active === s.scheme;
        const gap = Math.round((best.margin - s.margin) * 10) / 10;
        return (
          <Card
            key={s.scheme}
            onClick={() => onSelect(isActive ? '' : s.scheme)}
            className={`cursor-pointer transition-colors ${
              isActive
                ? 'border-primary ring-1 ring-primary'
                : 'hover:border-muted-foreground/40'
            }`}
          >
            <CardContent className="space-y-2 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="flex items-center gap-1.5 font-bold">
                  <Icon
                    name={s.scheme === 'FBO' ? 'Package' : 'Truck'}
                    fallback="Package"
                    size={15}
                  />
                  {s.scheme}
                  <span className="text-xs font-normal text-muted-foreground">
                    {HINT[s.scheme] || ''}
                  </span>
                </p>
                {isActive && (
                  <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                    показаны
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span>
                  <span className="text-xs text-muted-foreground">Маржа </span>
                  <span
                    className={`text-xl font-bold ${
                      s.margin >= best.margin
                        ? 'text-emerald-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {s.margin}%
                  </span>
                </span>
                <span>
                  <span className="text-xs text-muted-foreground">
                    Площадка забрала{' '}
                  </span>
                  <span className="font-bold tabular-nums text-rose-700">
                    {s.feeShare === null ? '—' : `${s.feeShare}%`}
                  </span>
                </span>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                <span>
                  Выручка{' '}
                  <span className="font-medium text-foreground">
                    {money(s.revenue)} ₽
                  </span>
                </span>
                <span>
                  Заработали{' '}
                  <span
                    className={`font-medium ${
                      s.profit > 0 ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {s.profit > 0 ? '+' : ''}
                    {money(s.profit)} ₽
                  </span>
                </span>
                <span>
                  Вещей{' '}
                  <span className="font-medium text-foreground">
                    {money(s.quantity)}
                  </span>
                </span>
              </div>

              {/* Отставание от лучшей схемы — в этом весь смысл сравнения. */}
              {gap > 0.05 && (
                <p className="text-xs text-amber-700">
                  На {gap} п.п. хуже, чем {best.scheme}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default BuyoutsSchemes;