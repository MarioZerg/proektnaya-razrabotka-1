import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';

interface MeterageScanStatusProps {
  lastShown: string | null;
  unit: string;
  hint: string;
  onUndoLast: () => void;
}

const MeterageScanStatus = ({ lastShown, unit, hint, onUndoLast }: MeterageScanStatusProps) => (
  <div className="shrink-0 rounded-md border border-border bg-muted/70 px-3 py-2.5 pr-10">
    {lastShown ? (
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted-foreground">Последний рулон</p>
          <p className="truncate font-bold tabular-nums leading-none tracking-tight">
            <span className="text-4xl sm:text-5xl">{lastShown}</span>
            <span className="ml-1.5 text-xl text-muted-foreground sm:text-2xl">
              {unit} × 1
            </span>
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="h-12 w-12 shrink-0 p-0 text-muted-foreground hover:text-destructive"
          title="Убрать этот рулон"
          onClick={onUndoLast}
        >
          <Icon name="X" size={22} />
        </Button>
      </div>
    ) : null}
    <p
      className={`text-base font-medium leading-snug ${lastShown ? 'mt-1.5' : ''} ${
        hint.includes('в строке') ? 'text-emerald-700' : 'text-foreground'
      }`}
    >
      {hint}
    </p>
  </div>
);

export default MeterageScanStatus;
