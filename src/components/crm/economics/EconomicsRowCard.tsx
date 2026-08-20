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
const EconomicsRowCard = ({ row }: { row: EconomicsRow }) => {
  const [open, setOpen] = useState(false);
  const u = row.unit;

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
          </p>
          <p className="text-xs text-muted-foreground">
            {row.productsCount} размеров по высоте
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
            <span>Продвижение</span>
            <span>−{money(u.promo)} ₽</span>
          </div>
        )}
        <div className="flex justify-between border-t border-border pt-1 text-xs">
          <span className="font-medium">Себестоимость производства</span>
          <span className="font-medium">−{money(u.productionCost)} ₽</span>
        </div>
        {/* НДС показываем отдельно от УСН: это разные налоги с разной базой,
            и владельцу важно видеть, сколько забирает каждый. */}
        {u.vat > 0 && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>НДС в цене</span>
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