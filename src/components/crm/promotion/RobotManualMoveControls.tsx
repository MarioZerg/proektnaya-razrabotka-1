import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';

/**
 * Поля «на сколько %», «причина», кнопка запуска и строка прогресса.
 * Логика 1:1 перенесена из RobotManualMove.
 */
interface Props {
  step: string;
  setStep: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  maxStep: number;
  busy: boolean;
  stepOk: boolean;
  pending: boolean;
  pickedCount: number;
  value: number;
  onStart: () => void;
  progress?: string | null;
}

const RobotManualMoveControls = ({
  step,
  setStep,
  note,
  setNote,
  maxStep,
  busy,
  stepOk,
  pending,
  pickedCount,
  value,
  onStart,
  progress,
}: Props) => (
  <>
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label>На сколько, %</Label>
        <Input
          type="number"
          step="0.5"
          min={0.1}
          max={maxStep}
          value={step}
          onChange={(e) => setStep(e.target.value)}
          className="w-[110px]"
          disabled={busy}
        />
        <p className="text-[11px] text-muted-foreground">
          Не больше {maxStep}% за раз
        </p>
      </div>
      <div className="min-w-[200px] flex-1 space-y-1.5">
        <Label>Причина (в журнал)</Label>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Например: выровнять после акции"
          disabled={busy}
        />
      </div>
      <Button
        onClick={onStart}
        disabled={busy || !stepOk || (!pending && pickedCount === 0)}
      >
        <Icon
          name={busy ? 'Loader2' : 'TrendingUp'}
          size={15}
          className={`mr-1.5 ${busy ? 'animate-spin' : ''}`}
        />
        {pending
          ? 'Продолжить отправку'
          : `Поднять ${pickedCount} на ${Math.abs(value) || 0}%`}
      </Button>
    </div>

    {busy && progress && (
      <p className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-sm font-medium">
        <Icon name="Loader2" size={15} className="animate-spin" />
        {progress}
      </p>
    )}
  </>
);

export default RobotManualMoveControls;
