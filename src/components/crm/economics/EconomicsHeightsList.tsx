import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { EconomicsRow, UnitCalc } from '@/lib/unitEconomicsApi';
import { money, moneyShort, profitColor } from './economicsShared';

/**
 * Нижняя часть плашки: граница цены, пробелы в расчёте и разбор по высотам.
 *
 * У каждой высоты своя цена на витрине, поэтому одна может быть убыточной,
 * пока соседняя приносит прибыль. Список раскрывается по требованию: в
 * свёрнутом виде он забивал бы карточку.
 */
interface Props {
  row: EconomicsRow;
  u: UnitCalc;
  /** Раскрыт ли разбор по высотам. */
  open: boolean;
  setOpen: (fn: (v: boolean) => boolean) => void;
}

const EconomicsHeightsList = ({ row, u, open, setOpen }: Props) => (
  <>
    {/* Нижняя граница цены: главный ориентир при участии в акциях. */}
    {u.breakEvenPrice != null && (
      <div className="mt-2 rounded-md border border-border bg-background/70 p-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Минимальная цена без убытка</span>
          <span className="font-bold">{money(u.breakEvenPrice)} ₽</span>
        </div>
        {u.price > u.breakEvenPrice && (
          <p className="mt-0.5 text-muted-foreground">
            Запас до убытка {money(u.price - u.breakEvenPrice)} ₽ — можно дать скидку
            до {Math.floor(((u.price - u.breakEvenPrice) / u.price) * 100)}%
          </p>
        )}
      </div>
    )}

    {row.missing.length > 0 && (
      <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-100 p-2 text-xs text-amber-900">
        <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Расчёт неполный</p>
          <p>{row.missing.join(' · ')}</p>
        </div>
      </div>
    )}

    {/* Разбор по высотам: у каждой высоты своя цена на витрине. */}
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="mt-2 flex items-center gap-1 text-xs font-medium text-primary"
    >
      <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} />
      {open ? 'Скрыть' : 'Показать'} расчёт по высотам ({row.heights.length})
    </button>

    {open && (
      <div className="mt-2 space-y-1">
        {row.heights.map((h) => (
          <div
            key={h.itemId}
            className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs"
          >
            <span className="min-w-0 truncate">
              {h.height ? `${row.width}×${h.height}` : h.name}
              {h.source === 'manual' && (
                <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]">
                  вручную
                </Badge>
              )}
            </span>
            {h.unit ? (
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-muted-foreground">{moneyShort(h.unit.price)} ₽</span>
                {/* Логистика у каждого размера своя: площадка считает её по
                    габаритам упаковки. Показываем рядом с ценой — видно, где
                    доставка съедает прибыль сильнее всего. */}
                <span
                  className="w-20 text-right text-muted-foreground"
                  title={`Доставка по тарифу ${moneyShort(h.unit.logisticsBase)} ₽ · с учётом выкупа ${h.unit.buyoutPercent}% — ${moneyShort(h.unit.logistics)} ₽`}
                >
                  <Icon name="Truck" size={11} className="mr-0.5 inline" />
                  {moneyShort(h.unit.logisticsBase)} ₽
                </span>
                <span className={`font-bold ${profitColor(h.unit.margin)}`}>
                  {h.unit.profit > 0 ? '+' : ''}
                  {moneyShort(h.unit.profit)} ₽
                </span>
                <span className="w-12 text-right text-muted-foreground">
                  {h.unit.margin}%
                </span>
              </span>
            ) : (
              <span className="shrink-0 text-muted-foreground">нет цены</span>
            )}
          </div>
        ))}
      </div>
    )}
  </>
);

export default EconomicsHeightsList;
