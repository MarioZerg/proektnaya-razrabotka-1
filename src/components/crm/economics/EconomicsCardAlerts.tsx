import Icon from '@/components/ui/icon';
import type { EconomicsRow, HeightRow, UnitCalc } from '@/lib/unitEconomicsApi';
import { money, moneyShort, profitColor } from './economicsShared';

/**
 * Пояснения и предупреждения над разбором расходов.
 *
 * Сюда собрано всё, что отвечает на вопрос «почему цифра такая»: откуда взялась
 * цена, где реклама съедает прибыль, какие размеры уходят в минус и по какой
 * схеме товар выгоднее.
 */
interface Props {
  row: EconomicsRow;
  current: HeightRow | null;
  u: UnitCalc;
  /** Какая схема сейчас открыта — подписываем ей цифры. */
  scheme?: string;
  /** Вторая схема для сравнения. */
  altScheme?: string | null;
}

const EconomicsCardAlerts = ({
  row,
  current,
  u,
  scheme,
  altScheme,
}: Props) => (
  <>
    {/* ЦЕПОЧКА ЦЕН OZON.
        Самый частый вопрос: «на витрине одна цена, у вас другая». Цен
        действительно четыре, и путать их легко:
          карточка   — что мы выставили;
          витрина    — что видит покупатель после акций площадки;
          начислено  — что площадка начислила НАМ за проданную вещь;
        именно с последней берётся комиссия, и именно она — база расчёта.
        Показываем всю цепочку, чтобы цифру можно было проверить. */}
    <div className="mt-2 rounded-md border border-border bg-background/60 p-2 text-xs">
      <p className="font-medium">Как получена цена в расчёте</p>
      <div className="mt-1 space-y-0.5">
        {!!current?.cardPrice && (
          <p className="flex justify-between gap-2 text-muted-foreground">
            <span>Наша цена в карточке</span>
            <span>{money(current.cardPrice)} ₽</span>
          </p>
        )}
        {!!current?.showcasePrice && (
          <p className="flex justify-between gap-2 text-muted-foreground">
            <span>Покупатель видит на витрине</span>
            <span>{money(current.showcasePrice)} ₽</span>
          </p>
        )}
        <p className="flex justify-between gap-2 border-t border-border pt-0.5 font-medium">
          <span>
            {current?.priceSource2 === 'realization'
              ? `Цена продажи по отчёту OZON (${current.realizationCount} продаж)`
              : current?.priceSource2 === 'fact'
                ? `Площадка начислила нам (${current.factSaleCount} продаж)`
                : current?.priceSource2 === 'showcase'
                  ? 'Считаем по витрине'
                  : 'Считаем по цене карточки'}
          </span>
          <span>{money(u.price)} ₽</span>
        </p>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {current?.priceSource2 === 'realization' ? (
          <>
            {/* Цена продавца из официального отчёта — полная сумма
                покупателя, включая оплаченную баллами. Это и налоговая
                база: при УСН доход считается со всей цены, а не с того,
                что площадка перечислила на счёт. */}
            Полная цена покупателя из отчёта о реализации — включая часть,
            оплаченную баллами. С неё же считается налог: комиссия площадки
            налоговую базу не уменьшает
          </>
        ) : current?.priceSource2 === 'fact' ? (
          <>
            Комиссия площадки считается именно с начисленной суммы, поэтому
            она и есть база расчёта. Оплата картой площадки, регион и баллы
            в ней уже учтены
          </>
        ) : (
          <>
            Продаж за месяц не было — считаем по витрине. Начисленная сумма
            может отличаться
          </>
        )}
      </p>
    </div>

    {/* ПЕРЕРАСХОД РЕКЛАМЫ.
        Кампании живут в кабинете площадки отдельно от экономики, и связь
        «эта реклама съела всю прибыль» нигде не видна. По WB нашлись
        позиции, где на продвижение ушло 15 270 ₽ при выручке 1 720 ₽.
        Показываем в рублях: сколько вернётся, если урезать до нормы. */}
    {!!u.promoOverspend && !!u.promoWaste && (
      <p className="mt-2 flex items-start gap-1.5 rounded-md bg-rose-50 p-2 text-xs text-rose-900">
        <Icon name="TrendingDown" size={13} className="mt-0.5 shrink-0" />
        <span>
          Реклама съедает {money(u.promoWaste)} ₽ с вещи сверх нормы —
          снизьте ставки в кампании, прибыль вырастет на эту сумму
        </span>
      </p>
    )}

    {/* Доля площадки в скидке.
        Показываем ТОЛЬКО когда нам начислили больше, чем видит покупатель:
        значит часть скидки площадка взяла на себя, и эти деньги к нам
        вернулись. Если начисление совпало с витриной, доли площадки нет —
        и фраза о ней только путала бы. */}
    {!!current?.showcasePrice &&
      current.priceSource2 === 'fact' &&
      u.price > current.showcasePrice + 1 && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-sky-50 p-2 text-xs text-sky-900">
          <Icon name="BadgePercent" size={13} className="mt-0.5 shrink-0" />
          <span>
            Покупатель заплатил {money(current.showcasePrice)} ₽, а нам
            начислили {money(u.price)} ₽ — разницу{' '}
            {money(u.price - current.showcasePrice)} ₽ площадка взяла на себя
          </span>
        </p>
      )}

    {/* Убыточные размеры внутри прибыльной группы.
        Шапка показывает среднее, и минусовые высоты за ним прячутся:
        «Вуаль 200 см» в среднем в плюсе, а высоты 285 и 295 см — минус
        70 ₽. Именно с такими позициями и надо работать. */}
    {!!row.lossHeights && row.lossHeights > 0 && (
      <p className="mt-2 flex items-start gap-1.5 rounded-md bg-rose-100 p-2 text-xs font-medium text-rose-900">
        <Icon name="TrendingDown" size={13} className="mt-0.5 shrink-0" />
        <span>
          {row.lossHeights} из {row.pricedCount} размеров продаются в минус
          {/* Главная причина. Цена и логистика внутри группы одинаковые, и
              если убыточные отличаются только рекламой — дело в ней, а не
              в цене. Иначе непонятно, почему соседние высоты разные. */}
          {!!row.lossFromPromo && row.lossFromPromo > 0 ? (
            <>
              {' '}
              · {row.lossFromPromo} из них — из-за расходов на рекламу, без
              неё были бы прибыльны
            </>
          ) : (
            <> — разверните расчёт по высотам</>
          )}
        </span>
      </p>
    )}

    {/* Расчёт по цене витрины — предупреждение.
        Площадка режет цену акциями, и если фактическую она не отдала, мы
        считаем по завышенной: товар в акции выглядит прибыльным, будучи
        убыточным. Владелец должен знать, где цифрам верить нельзя. */}
    {row.actualPriceCount != null &&
      row.actualPriceCount < row.pricedCount && (
        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-100 p-2 text-xs text-amber-900">
          <Icon name="TriangleAlert" size={13} className="mt-0.5 shrink-0" />
          {row.pricedCount - row.actualPriceCount} из {row.pricedCount}{' '}
          размеров считаются по цене витрины — площадка не отдала цену с
          учётом акций. Реальная прибыль может быть ниже
        </p>
      )}

    {/* Сравнение схем: у FBS и FBO разная логистика и комиссия, и по одной
        цифре не понять, где товар выгоднее. Показываем обе рядом — видно,
        какую схему выбрать под конкретный размер. */}
    {!!row.altUnit && !!altScheme && (
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-md border border-primary/40 bg-background/60 p-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            {scheme} · открыто
          </p>
          <p className={`text-sm font-bold ${profitColor(u.margin)}`}>
            {u.profit > 0 ? '+' : ''}
            {money(u.profit)} ₽
          </p>
          <p className="text-[11px] text-muted-foreground">
            маржа {u.margin}% · логистика {moneyShort(u.logistics)} ₽
          </p>
        </div>
        <div className="rounded-md border border-border bg-background/40 p-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            {altScheme}
          </p>
          <p className={`text-sm font-bold ${profitColor(row.altUnit.margin)}`}>
            {row.altUnit.profit > 0 ? '+' : ''}
            {money(row.altUnit.profit)} ₽
          </p>
          <p className="text-[11px] text-muted-foreground">
            маржа {row.altUnit.margin}% · логистика{' '}
            {moneyShort(row.altUnit.logistics)} ₽
          </p>
        </div>
        {/* Прямой ответ на вопрос «где выгоднее»: без него владелец
            сравнивает четыре числа глазами. */}
        <p className="col-span-2 text-[11px] text-muted-foreground">
          {row.altUnit.profit > u.profit ? (
            <span className="font-medium text-emerald-700">
              По {altScheme} выгоднее на{' '}
              {money(row.altUnit.profit - u.profit)} ₽ с вещи
            </span>
          ) : (
            <span className="font-medium text-emerald-700">
              По {scheme} выгоднее на {money(u.profit - row.altUnit.profit)} ₽
              с вещи
            </span>
          )}
        </p>
      </div>
    )}
  </>
);

export default EconomicsCardAlerts;
