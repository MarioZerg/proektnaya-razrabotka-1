import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import MeterageCameraView from './meterage-scan/MeterageCameraView';
import MeterageScanStatus from './meterage-scan/MeterageScanStatus';
import { useMeterageScanner } from './meterage-scan/useMeterageScanner';

interface MeterageScanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Метраж одного рулона, как на бирке: «63,3». */
  onMeterage: (quantity: string) => void;
  /** Последний принятый метраж — кладовщик видит его, пока сканирует дальше. */
  lastQty: string | null;
  /** Убрать последний рулон из приёмки, если скан ошибочный. */
  onUndoLast: () => void;
  unit: string;
}

/**
 * Камера метража на приёмке. Картинка с камеры только для прицела —
 * цифры читаются по кнопке и только из белой рамки.
 */
const MeterageScanDialog = ({
  open,
  onOpenChange,
  onMeterage,
  lastQty,
  onUndoLast,
  unit,
}: MeterageScanDialogProps) => {
  const {
    videoRef,
    camError,
    hint,
    reading,
    ownQty,
    handleScanClick,
    focusAtTap,
    handleUndoLast,
  } = useMeterageScanner({ open, onMeterage, onUndoLast, unit });

  const lastShown = (lastQty || ownQty)?.replace('.', ',') ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        confirmClose={false}
        overlayClassName="z-[60]"
        className="!fixed !left-0 !top-0 !z-[70] flex !h-[100dvh] !max-h-[100dvh] !w-full !max-w-full !translate-x-0 !translate-y-0 flex-col gap-2 overflow-y-auto overflow-x-hidden rounded-none p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:!left-[50%] sm:!top-[50%] sm:!h-auto sm:!max-h-[90dvh] sm:!w-full sm:!max-w-lg sm:!translate-x-[-50%] sm:!translate-y-[-50%] sm:rounded-lg sm:p-6 sm:pb-6"
      >
        <DialogTitle className="sr-only">Метраж</DialogTitle>

        <MeterageScanStatus
          lastShown={lastShown}
          unit={unit}
          hint={hint}
          onUndoLast={handleUndoLast}
        />

        {camError && <p className="shrink-0 text-sm text-destructive">{camError}</p>}

        <MeterageCameraView
          videoRef={videoRef}
          reading={reading}
          onFocusAtTap={focusAtTap}
        />

        <Button
          type="button"
          className="h-12 w-full shrink-0"
          disabled={reading}
          onClick={handleScanClick}
        >
          <Icon name="ScanLine" size={16} className="mr-2" />
          Считать штрих-код с метражом
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default MeterageScanDialog;
