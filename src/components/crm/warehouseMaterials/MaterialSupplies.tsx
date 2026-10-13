import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import { fetchMaterialSupplies, type MaterialSupply, type SupplyRoll } from '@/lib/materialsApi';

interface MaterialSuppliesProps {
  materialId: number;
  unit: string;
}

const qty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('ru-RU');
const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

const STATE: Record<SupplyRoll['state'], { label: string; className: string }> = {
  storage: { label: 'На складе', className: 'bg-emerald-100 text-emerald-800' },
  workshop: { label: 'В цехе', className: 'bg-sky-100 text-sky-800' },
  done: { label: 'Израсходован', className: 'bg-muted text-muted-foreground' },
  removed: { label: 'Убран', className: 'bg-muted text-muted-foreground' },
};

const SupplyRow = ({ supply, unit, materialId }: { supply: MaterialSupply; unit: string; materialId: number }) => {
  const storeKey = `wm-open-supply-${materialId}-${supply.key}`;
  const [open, setOpenState] = useState(() => sessionStorage.getItem(storeKey) === '1');
  const setOpen = (fn: (v: boolean) => boolean) =>
    setOpenState((v) => {
      const next = fn(v);
      if (next) sessionStorage.setItem(storeKey, '1');
      else sessionStorage.removeItem(storeKey);
      return next;
    });
  const live = supply.inStorage + supply.inWorkshop;
  return (
    <div className="rounded-md border border-border bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/40"
      >
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium">
            <span>{supply.shipmentId ? `Поставка №${supply.shipmentId}` : 'Без номера поставки'}</span>
            <span className="text-xs font-normal text-muted-foreground">от {date(supply.date)}</span>
          </div>
          <div className="truncate text-xs text-muted-foreground">{supply.supplierName}</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            <span>
              Числится: <b>{live}</b> из {supply.total}
            </span>
            {supply.inStorage > 0 && <span className="text-emerald-700">склад {supply.inStorage}</span>}
            {supply.inWorkshop > 0 && <span className="text-sky-700">цех {supply.inWorkshop}</span>}
            {supply.done > 0 && <span className="text-muted-foreground">закрыто {supply.done}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right text-sm font-semibold tabular-nums">
          {qty(supply.remaining)} {unit}
        </div>
      </button>
      {open && (
        <div className="divide-y divide-border border-t border-border">
          {supply.rolls.map((r) => (
            <Link
              key={r.id}
              to={`/crm/inventory/rolls/${r.id}`}
              state={{ from: '/crm/inventory/warehouse-materials' }}
              title="Открыть рулон: проверить и напечатать стикер"
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50',
                (r.state === 'done' || r.state === 'removed') && 'opacity-60',
              )}
            >
              <div className="min-w-0">
                <span className="font-mono text-sm font-semibold text-primary underline-offset-2 hover:underline">{r.barcode}</span>
                <span className={cn('ml-2 rounded px-1.5 py-0.5 text-[11px]', STATE[r.state].className)}>
                  {STATE[r.state].label}
                </span>
                {r.place && <span className="ml-2 text-muted-foreground">{r.place}</span>}
                {r.closedAt && <span className="ml-2 text-muted-foreground">{date(r.closedAt)}</span>}
              </div>
              <div className="text-right tabular-nums">
                {r.state === 'storage' || r.state === 'workshop' ? (
                  <>
                    <b>{qty(r.remaining)}</b>
                    <span className="text-muted-foreground"> / {qty(r.initial)} {unit}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">было {qty(r.initial)} {unit}</span>
                )}
              </div>
              <Icon name="ChevronRight" size={14} className="text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

/** Поставки материала с живыми рулонами. Полностью израсходованные не показываются. */
const MaterialSupplies = ({ materialId, unit }: MaterialSuppliesProps) => {
  const [supplies, setSupplies] = useState<MaterialSupply[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMaterialSupplies(materialId)
      .then((s) => alive && setSupplies(s))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Ошибка'));
    return () => {
      alive = false;
    };
  }, [materialId]);

  if (error) return <div className="px-3 py-3 text-sm text-destructive">{error}</div>;
  if (!supplies)
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
        <Icon name="Loader2" size={14} className="animate-spin" />
        Загружаю поставки...
      </div>
    );
  if (supplies.length === 0)
    return <div className="px-3 py-3 text-sm text-muted-foreground">Незакрытых поставок нет — все рулоны израсходованы.</div>;

  return (
    <div className="space-y-2 bg-muted/30 px-3 py-3">
      {supplies.map((s) => (
        <SupplyRow key={s.key} supply={s} unit={unit} materialId={materialId} />
      ))}
    </div>
  );
};

export default MaterialSupplies;
