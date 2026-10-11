import Icon from '@/components/ui/icon';
import {
  INSPECTION_STAGES,
  toneClass,
  toneIconClass,
} from '@/components/crm/goodsWarehouse/inspectionStages';
import type { InspectionCounts, InspectionStage } from '@/lib/goodsWarehouseApi';

interface ReturnsInspectionStagesProps {
  counts: InspectionCounts;
  stage: InspectionStage;
  onStageChange: (stage: InspectionStage) => void;
}

const barClass: Record<string, string> = {
  default: 'bg-muted-foreground',
  warning: 'bg-amber-500',
  danger: 'bg-destructive',
  success: 'bg-emerald-500',
};

const iconBoxClass: Record<string, string> = {
  default: 'bg-muted text-muted-foreground',
  warning: 'bg-amber-100 text-amber-700',
  danger: 'bg-destructive/10 text-destructive',
  success: 'bg-emerald-100 text-emerald-700',
};

/** Виджеты движения: клик переключает список ниже. Пустые серые, как плитки склада. */
const ReturnsInspectionStages = ({
  counts,
  stage,
  onStageChange,
}: ReturnsInspectionStagesProps) => (
  <div className="grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {INSPECTION_STAGES.map((s) => {
      const count = counts[s.key];
      const active = count > 0;
      return (
        <button
          key={s.key}
          type="button"
          onClick={() => onStageChange(s.key)}
          className={`relative flex w-full items-center gap-3 overflow-hidden rounded-lg border p-3 pl-4 text-left transition ${
            active ? toneClass[s.tone] : 'border-border bg-card hover:bg-muted/50'
          } ${stage === s.key ? 'ring-2 ring-primary ring-offset-1' : ''}`}
        >
          <span className={`absolute inset-y-0 left-0 w-1.5 ${active ? barClass[s.tone] : 'bg-muted'}`} />
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${
              active ? iconBoxClass[s.tone] : 'bg-muted text-muted-foreground'
            }`}
          >
            <Icon name={s.icon} size={18} className={active ? toneIconClass[s.tone] : undefined} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-tight">{s.title}</p>
            <p className="mt-0.5 text-xs leading-tight text-muted-foreground">{s.hint}</p>
          </div>
          <span
            className={`shrink-0 text-2xl font-bold tabular-nums ${
              active ? '' : 'text-muted-foreground/50'
            }`}
          >
            {count}
          </span>
        </button>
      );
    })}
  </div>
);

export default ReturnsInspectionStages;
