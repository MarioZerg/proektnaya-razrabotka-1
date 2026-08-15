import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface KioskRollDefectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Номер рулона — виден в заголовке, чтобы закройщик не отставил соседний. */
  barcode: string;
  defectReason: string;
  setDefectReason: (value: string) => void;
  saving: boolean;
  onConfirm: () => void;
}

/** Окно «отставить рулон»: брак в начале полотна, резать дальше нельзя. */
const KioskRollDefectDialog = ({
  open,
  onOpenChange,
  barcode,
  defectReason,
  setDefectReason,
  saving,
  onConfirm,
}: KioskRollDefectDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="kiosk-root sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Отставить рулон #{barcode}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <p className="text-base text-muted-foreground">
          Рулон перестанет идти в раскрой и будет ждать, пока кладовщик заберёт его
          на склад. Обязательно сообщите руководителю
        </p>
        {/* Причина — кнопками: закройщик стоит у станка и работает пальцами,
            клавиатуры в цехе нет. Можно отметить несколько дефектов сразу. */}
        <div className="grid grid-cols-2 gap-2">
          {['Дырки', 'Затяжки', 'Полосы', 'Пятна', 'Кривая кромка', 'Разнотон', 'Рвётся', 'Не тот метраж'].map(
            (label) => {
              const chosen = defectReason.split(', ').filter(Boolean);
              const active = chosen.includes(label);
              return (
                <Button
                  key={label}
                  type="button"
                  variant={active ? 'default' : 'outline'}
                  className="h-14 text-base"
                  onClick={() =>
                    setDefectReason(
                      (active
                        ? chosen.filter((c) => c !== label)
                        : [...chosen, label]
                      ).join(', ')
                    )
                  }
                >
                  {active && <Icon name="Check" size={18} className="mr-1.5" />}
                  {label}
                </Button>
              );
            }
          )}
        </div>
        <Button
          size="lg"
          className="h-14 w-full"
          onClick={onConfirm}
          disabled={saving || !defectReason.trim()}
        >
          {saving ? (
            <Icon name="Loader2" size={22} className="animate-spin" />
          ) : (
            'Отставить рулон'
          )}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
);

export default KioskRollDefectDialog;
