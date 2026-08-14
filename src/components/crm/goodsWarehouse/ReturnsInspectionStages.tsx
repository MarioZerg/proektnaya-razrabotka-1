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

/** Виджеты движения: клик переключает список ниже. */
const ReturnsInspectionStages = ({
  counts,
  stage,
  onStageChange,
}: ReturnsInspectionStagesProps) => (
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
    {INSPECTION_STAGES.map((s) => (
      <button
        key={s.key}
        type="button"
        onClick={() => onStageChange(s.key)}
        className={`rounded-lg border p-3 text-left transition ${toneClass[s.tone]} ${
          stage === s.key ? 'ring-2 ring-primary ring-offset-1' : ''
        }`}
      >
        <div className="flex items-center gap-2">
          <Icon name={s.icon} size={16} className={toneIconClass[s.tone]} />
          <span className="text-2xl font-bold">{counts[s.key]}</span>
        </div>
        <p className="mt-1 text-sm font-medium leading-tight">{s.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground leading-tight">{s.hint}</p>
      </button>
    ))}
  </div>
);

export default ReturnsInspectionStages;
