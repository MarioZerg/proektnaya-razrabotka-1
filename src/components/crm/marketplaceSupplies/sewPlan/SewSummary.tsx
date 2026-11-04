import type { SewFabricRow, SewLocalization } from '@/lib/fboSewPlanApi';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toLocaleString('ru-RU')}%`);
const m = (v: number) => `${Math.round(v).toLocaleString('ru-RU')} м`;

interface SewSummaryProps {
  cluster: string;
  localization: SewLocalization;
  fabric: SewFabricRow[];
}

/** Локализация до/после и расход ткани по предложке. */
const SewSummary = ({ cluster, localization, fabric }: SewSummaryProps) => (
  <div className="grid gap-3 md:grid-cols-2">
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">Локализация (заказы со склада региона покупателя)</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div>
          <span className="text-2xl font-bold tabular-nums">{pct(localization.now)}</span>
          <span className="mx-1 text-muted-foreground">→</span>
          <span className="text-2xl font-bold tabular-nums text-emerald-700">{pct(localization.after)}</span>
          <span className="ml-1 text-xs text-muted-foreground">всего</span>
        </div>
        <div className="text-sm">
          {cluster}: {pct(localization.clusterNow)} → <b className="text-emerald-700">{pct(localization.clusterAfter)}</b>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        По {localization.orders.toLocaleString('ru-RU')} заказам Ozon за 28 дней. «После» — оценка, если эти
        вещи будут лежать на складе региона.
      </p>
    </div>
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">Ткань: склад + цех минус очередь раскроя</p>
      <ul className="mt-1 space-y-0.5 text-sm">
        {fabric.map((f) => (
          <li key={f.id} className="flex justify-between gap-2">
            <span>{f.name}</span>
            <span className={`tabular-nums ${f.after < 50 ? 'font-semibold text-destructive' : ''}`}>
              свободно {m(f.free)} · уйдёт {m(f.use)} · останется {m(f.after)}
            </span>
          </li>
        ))}
        {!fabric.length && <li className="text-muted-foreground">—</li>}
      </ul>
    </div>
  </div>
);

export default SewSummary;
