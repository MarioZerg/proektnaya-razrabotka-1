import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { formatQuantity } from '@/lib/formatQuantity';
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
  /** Метраж рулона: изначальный и остаток — сверить с фактом, когда стикера нет. */
  initialQuantity?: number;
  remainingQuantity?: number;
  unit?: string;
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
  initialQuantity,
  remainingQuantity,
  unit = '',
  defectReason,
  setDefectReason,
  saving,
  onConfirm,
}: KioskRollDefectDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="kiosk-root sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="text-3xl">Отставить рулон #{barcode}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        {initialQuantity !== undefined && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border-2 border-border p-3 text-center">
              <p className="text-lg text-muted-foreground">Было на рулоне</p>
              <p className="font-mono-tech text-3xl font-bold">
                {formatQuantity(initialQuantity)} {unit}
              </p>
            </div>
            {remainingQuantity !== undefined && (
              <div className="rounded-md border-2 border-border p-3 text-center">
                <p className="text-lg text-muted-foreground">Осталось по системе</p>
                <p className="font-mono-tech text-3xl font-bold">
                  {formatQuantity(remainingQuantity)} {unit}
                </p>
              </div>
            )}
          </div>
        )}
        <p className="text-xl text-muted-foreground">
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
                  className="h-20 text-xl font-semibold"
                  onClick={() =>
                    setDefectReason(
                      (active
                        ? chosen.filter((c) => c !== label)
                        : [...chosen, label]
                      ).join(', ')
                    )
                  }
                >
                  {active && <Icon name="Check" size={24} className="mr-2" />}
                  {label}
                </Button>
              );
            }
          )}
        </div>
        <Button
          size="lg"
          className="h-20 w-full text-2xl font-semibold"
          onClick={onConfirm}
          disabled={saving || !defectReason.trim()}
        >
          {saving ? (
            <Icon name="Loader2" size={28} className="animate-spin" />
          ) : (
            'Отставить рулон'
          )}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
);

export default KioskRollDefectDialog;