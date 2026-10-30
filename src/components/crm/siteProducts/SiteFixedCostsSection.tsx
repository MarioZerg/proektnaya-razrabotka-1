import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import type { SiteFixedCosts } from '@/lib/siteOrdersApi';
import { rub } from '@/components/crm/siteProducts/siteProductsShared';
import { breakEvenUnits } from '@/lib/sitePricing';

interface Props {
  step: ReactNode;
  fixedCosts: SiteFixedCosts | null;
  mode: 'shared' | 'site_only';
  units: string;
  unitsInvalid: boolean;
  /** Постоянные на одну вещь при выбранном режиме (черновик). */
  fixedUnit: number;
  avgMargin: { value: number; count: number } | null;
  canEdit: boolean;
  onMode: (m: 'shared' | 'site_only') => void;
  onUnits: (v: string) => void;
}

const MODES = [
  {
    value: 'shared',
    title: 'Делим со всеми каналами',
    text: 'Как сейчас: оклады и аренда делятся на все продажи — сайт и маркетплейсы вместе.',
  },
  {
    value: 'site_only',
    title: 'Только сайт',
    text: 'Если уйдём с маркетплейсов: все расходы делятся только на продажи сайта.',
  },
] as const;

/** Шаг «постоянные расходы»: как делить оклады, аренду и прочее на вещь сайта. */
const SiteFixedCostsSection = ({
  step,
  fixedCosts,
  mode,
  units,
  unitsInvalid,
  fixedUnit,
  avgMargin,
  canEdit,
  onMode,
  onUnits,
}: Props) => {
  const plan = Math.max(Number(units.replace(',', '.')) || 0, 1);
  const siteOnly = mode === 'site_only';
  // Точка безубыточности: все ежемесячные расходы, которые несёт сайт, когда он один.
  const monthlyAll = fixedCosts?.lines.reduce((s, l) => s + (l.isMonthly && l.monthly ? l.monthly : 0), 0) ?? 0;
  const breakEven = avgMargin ? breakEvenUnits(monthlyAll, avgMargin.value) : null;

  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        {step}
        Постоянные расходы: оклады, аренда, кодинг
      </h4>
      <p className="text-xs text-muted-foreground">
        Эти суммы платим каждый месяц при любых продажах. Чем меньше штук продаём — тем больше ложится на каждую.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            disabled={!canEdit}
            onClick={() => onMode(m.value)}
            className={`rounded-md border p-3 text-left transition ${
              mode === m.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/40'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Icon name={mode === m.value ? 'CircleDot' : 'Circle'} size={14} />
              {m.title}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{m.text}</span>
          </button>
        ))}
      </div>

      {siteOnly && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
          <span className="text-sm">Сколько штук в месяц планируем продавать через сайт:</span>
          <Input
            inputMode="numeric"
            value={units}
            disabled={!canEdit}
            onChange={(e) => onUnits(e.target.value)}
            className={`h-8 w-24 ${unitsInvalid ? 'border-red-500' : ''}`}
          />
          <span className="text-sm text-muted-foreground">шт</span>
          {fixedCosts?.siteSold30 != null && (
            <span className="text-xs text-muted-foreground">
              факт за 30 дней: {fixedCosts.siteSold30} шт · сейчас все каналы: {fixedCosts.allChannelsUnits} шт
            </span>
          )}
        </div>
      )}

      {!fixedCosts ? (
        <p className="text-xs text-muted-foreground">Расходы не загрузились — обновите страницу.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Расход</th>
                <th className="px-3 py-2 font-medium">В месяц</th>
                <th className="px-3 py-2 font-medium">Делим на</th>
                <th className="px-3 py-2 text-right font-medium">На одну вещь</th>
              </tr>
            </thead>
            <tbody>
              {fixedCosts.lines.map((l) => {
                const toSite = l.isMonthly && l.monthly != null && (siteOnly || l.channel === 'site');
                const per = toSite ? (l.monthly as number) / plan : l.perUnitShared;
                return (
                  <tr key={l.name} className="border-t border-border">
                    <td className="px-3 py-1.5">
                      {l.name}
                      {l.channel === 'site' && <span className="ml-1 text-[11px] text-sky-700">только сайт</span>}
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {l.monthly != null ? rub(l.monthly) : 'норма на штуку'}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">
                      {!l.isMonthly
                        ? '—'
                        : toSite
                          ? `${plan} шт сайта`
                          : `все продажи (${fixedCosts.allChannelsUnits} шт)`}
                    </td>
                    <td className="px-3 py-1.5 text-right">{rub(per)}</td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                <td className="px-3 py-2" colSpan={3}>
                  Итого на одну вещь сайта
                </td>
                <td className="px-3 py-2 text-right">{rub(fixedUnit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {fixedCosts && (
        <div className="flex items-start gap-2 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <Icon name="Target" size={16} className="mt-0.5 shrink-0" />
          {breakEven != null && avgMargin ? (
            <span>
              <b>Точка безубыточности сайта без маркетплейсов: {breakEven} шт в месяц.</b> Постоянные расходы{' '}
              {rub(monthlyAll)} в месяц, одна продажа по текущим ценам покрывает в среднем {rub(avgMargin.value)}{' '}
              (цена − налог − эквайринг − материалы и работа, без блогера). Меньше продаж — работаем в минус.
            </span>
          ) : (
            <span>
              Точку безубыточности посчитаем, когда у товаров сайта будут проставлены цены
              {avgMargin && avgMargin.value <= 0 ? ' выше материалов и работы' : ''}.
            </span>
          )}
        </div>
      )}

      {fixedCosts && fixedCosts.skipped.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Не входят в цену сайта (только маркетплейсы): {fixedCosts.skipped.join(', ')}.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Суммы и к какому каналу относится расход, меняются в{' '}
        <Link to="/crm/analytics/product-cost" className="text-sky-700 hover:underline">
          «Себестоимости товара» → Дополнительные расходы
        </Link>
        . Оклады — из «Финансов» за {fixedCosts?.salariedMonth || 'прошлый месяц'}.
      </p>
    </section>
  );
};

export default SiteFixedCostsSection;
