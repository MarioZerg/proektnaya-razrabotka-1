import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { CostGroup } from '@/lib/productCostApi';

const money = (v: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface FabricCostCardProps {
  /** Название ткани. */
  material: string;
  /** Все ширины этой ткани, отсортированные. */
  widths: CostGroup[];
}

/**
 * Плашка одной ткани с переключением по ширинам.
 *
 * Высота изделия на себестоимость не влияет: полотно кроят по ширине, тесьму
 * пришивают по ширине, пакет подбирают по ширине. Поэтому вместо 875 карточек
 * товара — 8 плашек по тканям, внутри каждой переключатель ширин от 200 до 800.
 *
 * Внутри сразу виден весь разбор: ткань, тесьма, упаковка, раскрой, пошив,
 * стикеровка, прочие расходы и налог — без лишних кликов.
 */
const FabricCostCard = ({ material, widths }: FabricCostCardProps) => {
  const [idx, setIdx] = useState(0);
  const g = widths[idx];
  if (!g) return null;

  const incomplete = g.missing.length > 0;
  const share = (v: number) => (g.total > 0 ? Math.round((v / g.total) * 100) : 0);

  return (
    <div
      className={`rounded-lg border p-4 ${
        incomplete ? 'border-amber-300 bg-amber-50/40' : 'border-border bg-card'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-bold leading-tight">{material}</p>
          <p className="text-xs text-muted-foreground">
            Ширина {g.width} см · закрывает {g.productsCount} размеров по высоте
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-2xl font-bold leading-none">{money(g.total)} ₽</p>
          <p className="text-xs text-muted-foreground">за 1 штуку</p>
        </div>
      </div>

      {/* Переключатель ширин — главный элемент плашки. */}
      <div className="mt-3 flex flex-wrap gap-1">
        {widths.map((w, i) => (
          <button
            key={w.width}
            type="button"
            onClick={() => setIdx(i)}
            className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
              i === idx
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/70'
            }`}
          >
            {w.width}
          </button>
        ))}
      </div>

      {/* Полоса состава: где сидят деньги. */}
      {g.total > 0 && (
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="bg-sky-500"
            style={{ width: `${share(g.materialsCost)}%` }}
            title={`Материалы ${money(g.materialsCost)} ₽`}
          />
          <div
            className="bg-amber-400"
            style={{ width: `${share(g.shortageCost || 0)}%` }}
            title={`Недостачи ${money(g.shortageCost || 0)} ₽`}
          />
          <div
            className="bg-emerald-500"
            style={{ width: `${share(g.laborCost)}%` }}
            title={`Работа ${money(g.laborCost)} ₽`}
          />
          <div
            className="bg-violet-400"
            style={{ width: `${share(g.overhead)}%` }}
            title={`Прочие расходы ${money(g.overhead)} ₽`}
          />
        </div>
      )}

      {/* Полный разбор сразу, без раскрытия: владелец пришёл смотреть именно на это. */}
      <div className="mt-3 space-y-2 text-sm">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Материалы · {money(g.materialsCost)} ₽
          </p>
          {g.materials.length === 0 ? (
            <p className="text-xs text-muted-foreground">Расход не задан</p>
          ) : (
            g.materials.map((m) => (
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

        {/* Недостачи — отдельной строкой, а не спрятаны внутри материалов:
            владелец должен видеть, сколько уносят обрезки и брак. */}
        {!!g.shortageCost && (
          <div className="flex items-center justify-between gap-2 rounded-md bg-amber-50 px-2 py-1.5 dark:bg-amber-950/30">
            <span className="flex min-w-0 items-center gap-1.5 text-xs">
              <Icon name="Scissors" size={13} className="shrink-0 text-amber-600" />
              <span className="truncate">
                Недостачи материалов
                <span className="text-muted-foreground">
                  {' '}
                  {g.shortagePercent ?? 5}% от материалов
                </span>
              </span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-amber-700 dark:text-amber-500">
              {money(g.shortageCost)} ₽
            </span>
          </div>
        )}

        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Работа цеха · {money(g.laborCost)} ₽
          </p>
          <div className="flex justify-between text-xs">
            <span>Раскрой</span>
            <span className="font-medium">{money(g.cutCost)} ₽</span>
          </div>
          <div className="flex justify-between text-xs">
            <span>Пошив</span>
            <span className="font-medium">{money(g.sewCost)} ₽</span>
          </div>
          <div className="flex justify-between text-xs">
            <span>Стикеровка</span>
            <span className="font-medium">{money(g.packWorkCost)} ₽</span>
          </div>
        </div>

        {g.overhead > 0 && (
          <div className="border-t border-border pt-2">
            <div className="flex justify-between text-xs">
              <span>Прочие расходы</span>
              <span className="font-medium">{money(g.overhead)} ₽</span>
            </div>
            {/* Вознаграждение менеджера показываем отдельной строкой: оно
                считается от продаж и меняется само, в отличие от статей,
                которые владелец задаёт руками. */}
            {!!g.overheadManager && g.overheadManager > 0 && (
              <div className="mt-0.5 flex justify-between text-xs text-muted-foreground">
                <span className="pl-2">· менеджер маркетплейсов</span>
                <span>{money(g.overheadManager)} ₽</span>
              </div>
            )}
          </div>
        )}
      </div>

      {incomplete && (
        <div className="mt-3 flex items-start gap-1.5 rounded-md bg-amber-100 p-2 text-xs text-amber-900">
          <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">Расчёт неполный</p>
            <p>{g.missing.join(' · ')}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default FabricCostCard;