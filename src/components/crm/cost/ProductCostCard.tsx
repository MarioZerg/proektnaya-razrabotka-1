import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { ProductCost } from '@/lib/productCostApi';

const money = (v: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface ProductCostCardProps {
  item: ProductCost;
}

/**
 * Плашка себестоимости одного товара.
 *
 * Показывает не одну цифру, а из чего она сложилась: ткань, фурнитура, упаковка,
 * оплата раскроя, пошива и стикеровки, прочие расходы и налог. Одна общая сумма
 * ничего не объясняет — владельцу нужно видеть, где именно сидят деньги, чтобы
 * понимать, что можно ужать.
 *
 * Если чего-то не хватает (не задан расход материалов, нет тарифа), плашка честно
 * об этом говорит: цифра, посчитанная по половине данных, хуже отсутствия цифры —
 * на неё ставят цену и уходят в минус.
 */
const ProductCostCard = ({ item }: ProductCostCardProps) => {
  const [open, setOpen] = useState(false);
  const incomplete = item.missing.length > 0;

  // Доля каждой части — по ней сразу видно, что главный расход это ткань.
  const share = (v: number) => (item.total > 0 ? Math.round((v / item.total) * 100) : 0);

  return (
    <div
      className={`rounded-lg border p-4 ${
        incomplete ? 'border-amber-300 bg-amber-50/50' : 'border-border bg-card'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-tight">{item.name}</p>
          <p className="text-xs text-muted-foreground">
            {item.material || '—'}
            {item.width && item.height ? ` · ${item.width}×${item.height}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xl font-bold leading-none">{money(item.total)} ₽</p>
          <p className="text-xs text-muted-foreground">за 1 штуку</p>
        </div>
      </div>

      {/* Полоса состава: ткань, работа, прочее — видно с одного взгляда. */}
      {item.total > 0 && (
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="bg-sky-500"
            style={{ width: `${share(item.materialsCost)}%` }}
            title={`Материалы ${money(item.materialsCost)} ₽`}
          />
          <div
            className="bg-emerald-500"
            style={{ width: `${share(item.laborCost)}%` }}
            title={`Работа ${money(item.laborCost)} ₽`}
          />
          <div
            className="bg-violet-400"
            style={{ width: `${share(item.overhead)}%` }}
            title={`Прочее ${money(item.overhead)} ₽`}
          />
          <div
            className="bg-amber-400"
            style={{ width: `${share(item.tax + item.commission)}%` }}
            title={`Налог и комиссия ${money(item.tax + item.commission)} ₽`}
          />
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <span className="text-muted-foreground">Материалы</span>
        <span className="text-right font-medium">{money(item.materialsCost)} ₽</span>
        <span className="text-muted-foreground">Работа цеха</span>
        <span className="text-right font-medium">{money(item.laborCost)} ₽</span>
        {item.overhead > 0 && (
          <>
            <span className="text-muted-foreground">Прочие расходы</span>
            <span className="text-right font-medium">{money(item.overhead)} ₽</span>
          </>
        )}
        {item.tax > 0 && (
          <>
            <span className="text-muted-foreground">Налог</span>
            <span className="text-right font-medium">{money(item.tax)} ₽</span>
          </>
        )}
        {item.commission > 0 && (
          <>
            <span className="text-muted-foreground">Комиссия площадки</span>
            <span className="text-right font-medium">{money(item.commission)} ₽</span>
          </>
        )}
      </div>

      {incomplete && (
        <div className="mt-3 flex items-start gap-1.5 rounded-md bg-amber-100 p-2 text-xs text-amber-900">
          <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Расчёт неполный</p>
            <p>{item.missing.join(' · ')}</p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} />
        {open ? 'Скрыть расшифровку' : 'Показать расшифровку'}
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t border-border pt-2 text-sm">
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              Материалы
            </p>
            {item.materials.length === 0 ? (
              <p className="text-xs text-muted-foreground">Расход не задан</p>
            ) : (
              item.materials.map((m) => (
                <div key={m.materialId} className="flex justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate">
                    {m.name}
                    <span className="text-muted-foreground">
                      {' '}
                      {m.quantity} {m.unit} × {money(m.pricePerUnit)} ₽
                    </span>
                    {m.priceSource === 'none' && (
                      <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]">
                        нет цены
                      </Badge>
                    )}
                  </span>
                  <span className="shrink-0 font-medium">{money(m.sum)} ₽</span>
                </div>
              ))
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
              Работа
            </p>
            <div className="flex justify-between text-xs">
              <span>Раскрой</span>
              <span className="font-medium">{money(item.cutCost)} ₽</span>
            </div>
            <div className="flex justify-between text-xs">
              <span>Пошив</span>
              <span className="font-medium">{money(item.sewCost)} ₽</span>
            </div>
            <div className="flex justify-between text-xs">
              <span>Стикеровка</span>
              <span className="font-medium">{money(item.packWorkCost)} ₽</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductCostCard;
