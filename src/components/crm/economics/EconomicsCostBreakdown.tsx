import type { UnitCalc } from '@/lib/unitEconomicsApi';
import { money, profitColor } from './economicsShared';

/**
 * Разбор цены: полоса расходов и построчный список, куда ушли деньги.
 *
 * Полоса даёт мгновенную картину — что съедает больше всего. Список ниже
 * расшифровывает каждую строку до рубля, чтобы цифру можно было проверить.
 */
interface Props {
  u: UnitCalc;
  /** Доля суммы в цене, % — ширина куска полосы. */
  share: (v: number) => number;
}

const EconomicsCostBreakdown = ({ u, share }: Props) => (
  <>
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
        <div
          className={`flex justify-between text-xs ${
            u.promoOverspend ? 'text-rose-700' : 'text-muted-foreground'
          }`}
        >
          {/* ДРР — доля рекламы в цене. Показываем процентом: по одной сумме
              непонятно, много это или мало для конкретного товара.
              Выше потолка подсвечиваем красным: такая реклама съедает
              прибыль быстрее, чем приносит продажи. */}
          <span>
            Продвижение
            {u.price > 0 && (
              <span className="ml-1 font-medium">
                · ДРР {Math.round((u.promo / u.price) * 1000) / 10}%
                {u.promoOverspend && ` при норме ${u.promoLimit}%`}
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
  </>
);

export default EconomicsCostBreakdown;
