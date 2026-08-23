import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import type { EconomicsRow } from '@/lib/unitEconomicsApi';
import { money, profitBg } from './economicsShared';
import EconomicsCardHeader from './EconomicsCardHeader';
import EconomicsCardAlerts from './EconomicsCardAlerts';
import EconomicsCostBreakdown from './EconomicsCostBreakdown';
import EconomicsHeightsList from './EconomicsHeightsList';

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
  const { user } = useAuth();
  // Заводить в акции может владелец или менеджер: это решение о деньгах.
  const canPromote = user?.role === 'admin' || user?.role === 'manager';
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
      <EconomicsCardHeader
        row={row}
        sizes={sizes}
        idx={idx}
        current={current}
        u={u}
        canPromote={canPromote}
        step={step}
      />

      <EconomicsCardAlerts
        row={row}
        current={current}
        u={u}
        scheme={scheme}
        altScheme={altScheme}
      />

      <EconomicsCostBreakdown u={u} share={share} />

      <EconomicsHeightsList row={row} u={u} open={open} setOpen={setOpen} />
    </div>
  );
};

export default EconomicsRowCard;
