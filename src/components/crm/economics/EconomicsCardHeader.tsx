import PromoteDialog from './PromoteDialog';
import Icon from '@/components/ui/icon';
import type { EconomicsRow, HeightRow, UnitCalc } from '@/lib/unitEconomicsApi';
import { money, moneyShort, profitColor } from './economicsShared';

/**
 * Шапка плашки: название, листание высот и главный ответ — сколько остаётся
 * с одной проданной вещи.
 *
 * Высоты листаются прямо здесь, потому что весь расчёт ниже пересчитывается
 * под выбранный размер: цена, логистика, реклама и прибыль у высот разные,
 * и по среднему их не разглядеть.
 */
interface Props {
  row: EconomicsRow;
  /** Высоты с ценой: только по ним есть расчёт. */
  sizes: HeightRow[];
  /** Какую высоту сейчас смотрим. */
  idx: number;
  current: HeightRow | null;
  /** Расчёт ВЫБРАННОЙ высоты, а не среднее по группе. */
  u: UnitCalc;
  /** Заводить в акции может владелец или менеджер: это решение о деньгах. */
  canPromote: boolean;
  step: (d: number) => void;
}

const EconomicsCardHeader = ({
  row,
  sizes,
  idx,
  current,
  u,
  canPromote,
  step,
}: Props) => (
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
      <p className="text-base font-bold leading-tight">
        {row.material} · {row.width} см
        {current?.height && (
          <span className="text-primary"> × {current.height} см</span>
        )}
      </p>

      {/* Листание высот прямо в шапке.
          Весь расчёт ниже пересчитывается под выбранный размер: цена,
          логистика, реклама и прибыль у высот разные, и по среднему их
          не разглядеть. */}
      {sizes.length > 1 && (
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            className="flex h-6 w-6 items-center justify-center rounded border border-border bg-background/70 hover:bg-background"
            title="Предыдущая высота"
          >
            <Icon name="ChevronLeft" size={13} />
          </button>
          <span className="min-w-[4.5rem] text-center text-xs font-medium">
            {idx + 1} из {sizes.length}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            className="flex h-6 w-6 items-center justify-center rounded border border-border bg-background/70 hover:bg-background"
            title="Следующая высота"
          >
            <Icon name="ChevronRight" size={13} />
          </button>
          {/* Ходовую отмечаем: по ней принимают решение о цене. */}
          {current?.height === row.topHeight?.height && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              ходовой · {row.topHeight?.soldUnits} шт за месяц
            </span>
          )}
          {!!current?.soldUnits && current.height !== row.topHeight?.height && (
            <span className="text-[11px] text-muted-foreground">
              {current.soldUnits} шт за месяц
            </span>
          )}
        </div>
      )}
      {/* Раньше здесь оговаривались, что цифры в шапке усреднённые.
          Теперь расчёт идёт по ВЫБРАННОЙ высоте, поэтому оговорка не
          нужна — показываем состав группы и её общие продажи. */}
      <p className="text-xs text-muted-foreground">
        {row.productsCount} размеров по высоте
        {!!row.soldUnits && row.soldUnits > 0 && (
          <> · всего {row.soldUnits} шт за месяц</>
        )}
        {row.minPrice !== row.maxPrice && row.minPrice != null && (
          <> · цены {moneyShort(row.minPrice)}–{moneyShort(row.maxPrice)} ₽</>
        )}
      </p>
    </div>
    <div className="shrink-0 text-right">
      {/* Продвижение прямо из карточки: видно прибыль — сразу и решение.
          Раньше акции жили отдельной страницей, и связать «этот товар
          убыточен» с «а вот его зовут в акцию» приходилось в голове. */}
      {canPromote && sizes.length > 0 && (
        <div className="mb-1 flex justify-end">
          <PromoteDialog
            offerIds={sizes.map((h) => h.sku).filter(Boolean) as string[]}
            title={`${row.material} · ${row.width} см`}
            material={row.material || undefined}
          />
        </div>
      )}
      <p className={`text-2xl font-bold leading-none ${profitColor(u.margin)}`}>
        {u.profit > 0 ? '+' : ''}
        {money(u.profit)} ₽
      </p>
      <p className="text-xs text-muted-foreground">
        маржа {u.margin}% · ROI {u.roi}%
      </p>
    </div>
  </div>
);

export default EconomicsCardHeader;