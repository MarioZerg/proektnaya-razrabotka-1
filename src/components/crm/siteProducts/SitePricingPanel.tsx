import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { saveSitePricing, type SiteFixedCosts, type SitePricing } from '@/lib/siteOrdersApi';
import { fixedPerUnit, recommendedPrice, siteProfit, targetProfit } from '@/lib/sitePricing';
import SiteFixedCostsSection from '@/components/crm/siteProducts/SiteFixedCostsSection';
import { rub } from '@/components/crm/siteProducts/siteProductsShared';

interface Props {
  pricing: SitePricing;
  /** Ширины, которые есть в каталоге сайта. */
  widths: number[];
  /** Переменная себестоимость по ширине (самая дорогая высота) — без постоянных расходов. */
  costByWidth: Record<number, number>;
  /** Постоянные расходы: оклады, аренда и т.п. */
  fixedCosts: SiteFixedCosts | null;
  /** Средний вклад одной продажи сайта в покрытие постоянных расходов. */
  avgMargin: { value: number; count: number } | null;
  canEdit: boolean;
  actor?: { id?: number; name?: string };
  onSaved: (p: SitePricing) => void;
}

const PCT_FIELDS = [
  { key: 'taxPct', label: 'Налог УСН', hint: 'Платим государству с каждой продажи', icon: 'Landmark' },
  { key: 'acquiringPct', label: 'Эквайринг', hint: 'Комиссия банка за приём оплаты картой', icon: 'CreditCard' },
  {
    key: 'bloggerPct',
    label: 'Блогеру',
    hint: 'Если покупка по его ссылке. Закладывается в цену сверху',
    icon: 'Megaphone',
  },
] as const;

const BASE_WIDTHS = [200, 300, 400, 500, 600, 700, 800];

const num = (v: string | undefined) => Number((v || '0').replace(',', '.'));

const toDraftWidths = (p: SitePricing) =>
  Object.fromEntries(Object.entries(p.profitByWidth || {}).map(([w, v]) => [w, String(v)]));

/** Настройки цены сайта: проценты с продажи, цель прибыли по ширинам и живой пример расчёта. */
const SitePricingPanel = ({ pricing, widths, costByWidth, fixedCosts, avgMargin, canEdit, actor, onSaved }: Props) => {
  const { toast } = useToast();
  const [pct, setPct] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'shared' | 'site_only'>('shared');
  const [units, setUnits] = useState('');
  const [byWidth, setByWidth] = useState<Record<string, string>>({});
  const [fillAll, setFillAll] = useState('');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const allWidths = useMemo(
    () =>
      [...new Set([...BASE_WIDTHS, ...widths, ...Object.keys(pricing.profitByWidth || {}).map(Number)])]
        .filter((w) => Number.isFinite(w) && w > 0)
        .sort((a, b) => a - b),
    [widths, pricing.profitByWidth]
  );

  const reset = () => {
    setPct(Object.fromEntries(PCT_FIELDS.map((f) => [f.key, String(pricing[f.key])])));
    setByWidth(toDraftWidths(pricing));
    setMode(pricing.fixedMode ?? 'shared');
    setUnits(String(pricing.siteMonthlyUnits ?? 300));
  };

  useEffect(reset, [pricing]);

  // Черновик — то, что сейчас на экране: пример считается по нему ещё до сохранения.
  const draft: SitePricing = useMemo(
    () => ({
      ...pricing,
      taxPct: num(pct.taxPct),
      acquiringPct: num(pct.acquiringPct),
      bloggerPct: num(pct.bloggerPct),
      fixedMode: mode,
      siteMonthlyUnits: Math.round(num(units)),
      profitByWidth: Object.fromEntries(
        Object.entries(byWidth)
          .filter(([, v]) => v.trim() !== '')
          .map(([w, v]) => [w, num(v)])
      ),
    }),
    [pricing, pct, byWidth, mode, units]
  );
  const fixedUnit = fixedPerUnit(fixedCosts, draft) ?? 0;

  const pctSum = draft.taxPct + draft.acquiringPct + draft.bloggerPct;
  const pctInvalid =
    PCT_FIELDS.some((f) => !Number.isFinite(num(pct[f.key])) || num(pct[f.key]) < 0) || pctSum >= 90;
  const widthInvalid = Object.values(byWidth).some(
    (v) => v.trim() !== '' && (!Number.isFinite(num(v)) || num(v) < 0)
  );

  const unitsInvalid = mode === 'site_only' && (!Number.isFinite(num(units)) || num(units) < 1);
  const changed =
    mode !== (pricing.fixedMode ?? 'shared') ||
    Math.round(num(units)) !== (pricing.siteMonthlyUnits ?? 300) ||
    PCT_FIELDS.some((f) => num(pct[f.key]) !== pricing[f.key]) ||
    allWidths.some((w) => (byWidth[String(w)] ?? '') !== String(pricing.profitByWidth?.[String(w)] ?? ''));

  const applyAll = () => {
    if (!fillAll.trim() || !Number.isFinite(num(fillAll))) return;
    setByWidth(Object.fromEntries(allWidths.map((w) => [String(w), fillAll.trim()])));
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveSitePricing(
        {
          profitByWidth: draft.profitByWidth,
          bloggerPct: draft.bloggerPct,
          taxPct: draft.taxPct,
          acquiringPct: draft.acquiringPct,
          fixedMode: mode,
          siteMonthlyUnits: Math.max(1, Math.round(num(units)) || 1),
        },
        actor
      );
      toast({ title: 'Настройки цен сохранены', description: 'Подсказки цен в таблице пересчитаны' });
      onSaved(saved);
    } catch (e) {
      toast({ title: 'Не удалось сохранить', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const step = (n: number) => (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground">
      {n}
    </span>
  );

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Icon name="Calculator" size={16} />
          Как считается цена на сайте
          {changed && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">не сохранено</span>
          )}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          налог {pricing.taxPct}% · эквайринг {pricing.acquiringPct}% · блогер {pricing.bloggerPct}% ·{' '}
          {(pricing.fixedMode ?? 'shared') === 'site_only'
            ? `только сайт, ${pricing.siteMonthlyUnits} шт/мес`
            : 'расходы делим со всеми каналами'}
          <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} />
        </span>
      </button>

      {open && (
        <div className="space-y-5 border-t border-border px-4 py-4">
          <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Цена = </span>
            (материалы и работа + постоянные расходы на штуку + желаемая прибыль) ÷ (100% − налог − эквайринг −
            блогер), вверх до 10 ₽. Так прибыль
            остаётся нам, даже если покупка пришла по ссылке блогера. Доставку Ozon сайт прибавляет к цене сам — в
            расчёте её нет.
          </div>

          <section className="space-y-2">
            <h4 className="flex items-center gap-2 text-sm font-medium">
              {step(1)}
              Что вычитается из цены
            </h4>
            <div className="grid gap-3 sm:grid-cols-3">
              {PCT_FIELDS.map((f) => (
                <label key={f.key} className="space-y-1 rounded-md border border-border p-3">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon name={f.icon} size={14} className="text-muted-foreground" />
                    {f.label}
                  </span>
                  <span className="flex items-center gap-1">
                    <Input
                      inputMode="decimal"
                      value={pct[f.key] ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => setPct((s) => ({ ...s, [f.key]: e.target.value }))}
                      className="h-8 w-20"
                    />
                    <span className="text-sm text-muted-foreground">% от цены</span>
                  </span>
                  <span className="block text-[11px] leading-snug text-muted-foreground">{f.hint}</span>
                </label>
              ))}
            </div>
            <p className={`text-xs ${pctSum >= 90 ? 'text-red-600' : 'text-muted-foreground'}`}>
              Всего уходит {Math.round(pctSum * 10) / 10}% цены
              {pctSum >= 90 ? ' — слишком много, сумма должна быть меньше 90%' : ''}
            </p>
          </section>

          <SiteFixedCostsSection
            step={step(2)}
            fixedCosts={fixedCosts}
            mode={mode}
            units={units}
            unitsInvalid={unitsInvalid}
            fixedUnit={fixedUnit}
            avgMargin={avgMargin}
            canEdit={canEdit}
            onMode={setMode}
            onUnits={setUnits}
          />

          <section className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h4 className="flex items-center gap-2 text-sm font-medium">
                {step(3)}
                Сколько хотим заработать чистыми с одной штуки
              </h4>
              {canEdit && (
                <div className="flex items-center gap-1">
                  <Input
                    inputMode="decimal"
                    value={fillAll}
                    onChange={(e) => setFillAll(e.target.value)}
                    placeholder="₽"
                    className="h-8 w-20"
                  />
                  <Button size="sm" variant="outline" className="h-8" onClick={applyAll} disabled={!fillAll.trim()}>
                    Всем ширинам
                  </Button>
                </div>
              )}
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Ширина</th>
                    <th className="px-3 py-2 font-medium">Прибыль со штуки</th>
                    <th className="px-3 py-2 font-medium">Материалы и работа</th>
                    <th className="px-3 py-2 font-medium">+ Постоянные</th>
                    <th className="px-3 py-2 font-medium">Цена выйдет</th>
                    <th className="px-3 py-2 font-medium">Останется нам: обычная / по блогеру</th>
                  </tr>
                </thead>
                <tbody>
                  {allWidths.map((w) => {
                    const own = byWidth[String(w)]?.trim();
                    const target = targetProfit(w, draft);
                    const variable = costByWidth[w];
                    const cost = variable != null ? variable + fixedUnit : undefined;
                    const price = cost != null ? recommendedPrice(cost, w, draft) : null;
                    const base = price != null && cost != null ? siteProfit(price, cost, draft) : null;
                    const blog = price != null && cost != null ? siteProfit(price, cost, draft, true) : null;
                    const inCatalog = widths.includes(w);
                    return (
                      <tr key={w} className="border-t border-border">
                        <td className="px-3 py-1.5">
                          <span className={inCatalog ? 'font-medium' : 'text-muted-foreground'}>{w} см</span>
                          {!inCatalog && <span className="ml-1 text-[11px] text-muted-foreground">нет на сайте</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-1">
                            <Input
                              inputMode="decimal"
                              value={byWidth[String(w)] ?? ''}
                              disabled={!canEdit}
                              placeholder={target != null ? String(target) : '—'}
                              onChange={(e) => setByWidth((s) => ({ ...s, [String(w)]: e.target.value }))}
                              className="h-8 w-24"
                            />
                            <span className="text-muted-foreground">₽</span>
                          </div>
                          {!own && target != null && (
                            <p className="text-[11px] text-muted-foreground">как у меньшей ширины</p>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{variable != null ? rub(variable) : '—'}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{variable != null ? rub(fixedUnit) : '—'}</td>
                        <td className="px-3 py-1.5 font-semibold">{price != null ? rub(price) : '—'}</td>
                        <td className="px-3 py-1.5 text-xs">
                          {base && blog ? (
                            <span className="text-emerald-700">
                              {rub(base.profit)} <span className="text-muted-foreground">/</span> {rub(blog.profit)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {cost == null ? 'нет себестоимости' : 'задайте прибыль'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Материалы и работа — самая дорогая высота этой ширины среди тканей сайта. Постоянные — из шага 2. Пустое поле — берётся прибыль
              ближайшей меньшей ширины. Пример пересчитывается сразу, ещё до сохранения.
            </p>
          </section>

          {canEdit && changed && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={save} disabled={saving || pctInvalid || widthInvalid || unitsInvalid}>
                <Icon name={saving ? 'Loader2' : 'Check'} size={14} className={`mr-1 ${saving ? 'animate-spin' : ''}`} />
                {saving ? 'Сохраняю…' : 'Сохранить настройки'}
              </Button>
              <Button size="sm" variant="ghost" onClick={reset} disabled={saving}>
                Отменить изменения
              </Button>
              {(pctInvalid || widthInvalid || unitsInvalid) && (
                <span className="text-xs text-red-600">Проверьте значения — есть ошибка</span>
              )}
            </div>
          )}
          {canEdit && !changed && (
            <p className="text-[11px] text-muted-foreground">
              Сохранение настроек не меняет цены на сайте само: в таблице у каждой ширины появится новая подсказка —
              нажмите «поставить».
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default SitePricingPanel;
