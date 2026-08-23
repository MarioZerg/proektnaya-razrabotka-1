import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { EconomicsRow } from '@/lib/unitEconomicsApi';
import { money, moneyShort, profitColor, profitBg } from './economicsShared';

/**
 * Плашка одного сочетания «ткань + ширина».
 *
 * Сверху главный ответ: сколько остаётся с одной проданной вещи. Ниже — полный
 * разбор, куда ушли деньги: комиссия, логистика, возвраты, своя себестоимость и
 * налог. Внутри разворачивается расчёт по каждой ВЫСОТЕ: цены у высот свои, и
 * одна высота может быть убыточной, пока соседняя приносит прибыль.
 */
interface CardProps {
  row: EconomicsRow;
  /** Какая схема сейчас открыта — подписываем ей цифры. */
  scheme?: string;
  /** Вторая схема для сравнения. */
  altScheme?: string | null;
}

const EconomicsRowCard = ({ row, scheme, altScheme }: CardProps) => {
  const [open, setOpen] = useState(false);

  // Высоты с ценой: только по ним есть расчёт.
  const sizes = (row.heights || []).filter((h) => h.unit?.price);

  // Какую высоту сейчас смотрим.
  //
  // По умолчанию — ХОДОВУЮ: она делает оборот, и решение о цене принимают по
  // ней. Раньше карточка показывала среднее по группе, и понять, что творится
  // с конкретным размером, было нельзя: одна высота в минусе, соседняя в
  // плюсе, а в шапке — усреднённая цифра, не похожая ни на одну из них.
  const topIdx = Math.max(
    0,
    sizes.findIndex((h) => h.height === row.topHeight?.height),
  );
  const [idx, setIdx] = useState(topIdx);
  const current = sizes[idx] || null;

  // Смотрим ВЫБРАННУЮ высоту, а не среднее по группе.
  const u = current?.unit || row.unit;

  const step = (d: number) =>
    setIdx((i) => (i + d + sizes.length) % sizes.length);

  if (!u) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="font-bold">
          {row.material} · {row.width} см
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Нет цены на площадке — обновите цены или задайте цену вручную
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Себестоимость производства: {money(row.cost.productionCost)} ₽
        </p>
      </div>
    );
  }

  const share = (v: number) => (u.price > 0 ? Math.round((v / u.price) * 100) : 0);

  return (
    <div className={`rounded-lg border p-4 ${profitBg(u.margin)}`}>
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
              {!!current?.soldUnits &&
                current.height !== row.topHeight?.height && (
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
          <p className={`text-2xl font-bold leading-none ${profitColor(u.margin)}`}>
            {u.profit > 0 ? '+' : ''}
            {money(u.profit)} ₽
          </p>
          <p className="text-xs text-muted-foreground">
            маржа {u.margin}% · ROI {u.roi}%
          </p>
        </div>
      </div>

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
              {current?.priceSource2 === 'fact'
                ? `Площадка начислила нам (${current.factSaleCount} продаж)`
                : current?.priceSource2 === 'showcase'
                  ? 'Считаем по витрине'
                  : 'Считаем по цене карточки'}
            </span>
            <span>{money(u.price)} ₽</span>
          </p>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {current?.priceSource2 === 'fact' ? (
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

      {/* Куда уходит цена: наглядная полоса. */}
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="bg-rose-400"
          style={{ width: `${share(u.commission)}%` }}
          title={`Комиссия ${money(u.commission)} ₽`}
        />
        <div
          className="bg-orange-400"
          style={{ width: `${share(u.logistics + u.returnCost + u.storage + u.acceptance)}%` }}
          title={`Логистика и хранение ${money(u.logistics + u.returnCost + u.storage + u.acceptance)} ₽`}
        />
        <div
          className="bg-sky-500"
          style={{ width: `${share(u.productionCost)}%` }}
          title={`Себестоимость ${money(u.productionCost)} ₽`}
        />
        <div
          className="bg-violet-400"
          style={{ width: `${share(u.tax + u.vat + u.acquiring + u.promo)}%` }}
          title={`Налоги, эквайринг, реклама ${money(u.tax + u.vat + u.acquiring + u.promo)} ₽`}
        />
        {u.profit > 0 && (
          <div
            className="bg-emerald-500"
            style={{ width: `${share(u.profit)}%` }}
            title={`Прибыль ${money(u.profit)} ₽`}
          />
        )}
      </div>

      <div className="mt-3 space-y-1 text-sm">
        {/* Подчёркиваем, что это сумма, которую платит покупатель на кассе, а
            не наша цена в кабинете: от неё считаются комиссия и налоги. */}
        <div className="flex justify-between font-medium">
          <span>Платит покупатель</span>
          <span>{money(u.price)} ₽</span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Комиссия площадки {u.commissionPercent}%</span>
          <span>−{money(u.commission)} ₽</span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            Логистика
            {u.buyoutPercent < 100 && (
              <span className="ml-1 text-[11px]">
                (тариф {money(u.logisticsBase)} ÷ выкуп {u.buyoutPercent}%)
              </span>
            )}
          </span>
          <span>−{money(u.logistics)} ₽</span>
        </div>
        {u.returnCost > 0 && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Возвраты и отказы</span>
            <span>−{money(u.returnCost)} ₽</span>
          </div>
        )}
        {u.storage > 0 && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Хранение на складе площадки</span>
            <span>−{money(u.storage)} ₽</span>
          </div>
        )}
        {u.acceptance > 0 && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Приёмка поставки</span>
            <span>−{money(u.acceptance)} ₽</span>
          </div>
        )}
        {u.acquiring > 0 && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Эквайринг</span>
            <span>−{money(u.acquiring)} ₽</span>
          </div>
        )}
        {u.promo > 0 && (
          <div className="flex justify-between text-xs text-muted-foreground">
            {/* ДРР — доля рекламы в цене. Показываем процентом: по одной сумме
                непонятно, много это или мало для конкретного товара. */}
            <span>
              Продвижение
              {u.price > 0 && (
                <span className="ml-1 font-medium">
                  · ДРР {Math.round((u.promo / u.price) * 1000) / 10}%
                </span>
              )}
            </span>
            <span>−{money(u.promo)} ₽</span>
          </div>
        )}
        <div className="flex justify-between border-t border-border pt-1 text-xs">
          <span className="font-medium">Себестоимость производства</span>
          <span className="font-medium">−{money(u.productionCost)} ₽</span>
        </div>
        {/* НДС показываем отдельно от УСН: это разные налоги с разной базой,
            и владельцу важно видеть, сколько забирает каждый.
            
            Рядом со ставкой пишем саму формулу. Без неё цифра выглядит
            ошибочной: 5% от 3225 ₽ — это 161 ₽, а в расчёте 154 ₽. Причина
            в том, что НДС уже сидит ВНУТРИ цены и вынимается из неё, а не
            начисляется сверху. */}
        {u.vat > 0 && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              НДС {u.vatPercent}% в цене
              <span className="ml-1 text-[11px]">
                ({money(u.price)} × {u.vatPercent} ÷ {100 + u.vatPercent})
              </span>
            </span>
            <span>−{money(u.vat)} ₽</span>
          </div>
        )}
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>
            Налог УСН
            {u.vat > 0 && (
              <span className="ml-1 text-[11px]">
                (с {money(u.revenueNet)} ₽ без НДС)
              </span>
            )}
          </span>
          <span>−{money(u.tax)} ₽</span>
        </div>
        <div
          className={`flex justify-between border-t border-border pt-1 font-bold ${profitColor(u.margin)}`}
        >
          <span>Остаётся нам</span>
          <span>{money(u.profit)} ₽</span>
        </div>
      </div>

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
    </div>
  );
};

export default EconomicsRowCard;