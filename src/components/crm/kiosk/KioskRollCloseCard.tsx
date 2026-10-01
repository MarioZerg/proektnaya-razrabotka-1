import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import KioskRollDefectDialog from '@/components/crm/kiosk/KioskRollDefectDialog';
import type { Roll } from '@/lib/rollsApi';
import { formatQuantity } from '@/lib/formatQuantity';

interface KioskRollCloseCardProps {
  selected: Roll;
  saving: boolean;
  onClose: () => void;
  onCancel: () => void;
  defectOpen: boolean;
  setDefectOpen: (open: boolean) => void;
  defectReason: string;
  setDefectReason: (value: string) => void;
  onFlagDefect: () => void;
}

/** Карточка выбранного рулона: закрыть, когда ткань по факту кончилась,
 * или отставить бракованный рулон. Недостачу здесь не спрашиваем — сколько
 * метров числилось в системе, запишется само при закрытии. */
const KioskRollCloseCard = ({
  selected,
  saving,
  onClose,
  onCancel,
  defectOpen,
  setDefectOpen,
  defectReason,
  setDefectReason,
  onFlagDefect,
}: KioskRollCloseCardProps) => (
  <Card className="border-border shadow-none">
    <CardContent className="space-y-4 pt-6">
      <div className="text-center">
        <p className="text-xl text-muted-foreground">Рулон</p>
        <p className="font-mono-tech text-4xl font-bold">#{selected.barcode}</p>
        <p className="mt-1 text-xl">
          {selected.materialName} · остаток {formatQuantity(selected.remainingQuantity)}{' '}
          {selected.unit}
        </p>
      </div>

      {/* Изначальный метраж — для рулонов без стикера или закрываемых в чужую смену:
          сотрудник сверяет, сколько было на рулоне и сколько из него уже ушло. */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border-2 border-border p-3 text-center">
          <p className="text-lg text-muted-foreground">Было на рулоне</p>
          <p className="font-mono-tech text-3xl font-bold">
            {formatQuantity(selected.initialQuantity)} {selected.unit}
          </p>
        </div>
        <div className="rounded-md border-2 border-border p-3 text-center">
          <p className="text-lg text-muted-foreground">Израсходовано</p>
          <p className="font-mono-tech text-3xl font-bold">
            {formatQuantity(
              Math.max(0, selected.initialQuantity - selected.remainingQuantity)
            )}{' '}
            {selected.unit}
          </p>
        </div>
        <div className="rounded-md border-2 border-primary/40 bg-muted/40 p-3 text-center">
          <p className="text-lg text-muted-foreground">Осталось по системе</p>
          <p className="font-mono-tech text-3xl font-bold">
            {formatQuantity(selected.remainingQuantity)} {selected.unit}
          </p>
        </div>
      </div>

      <Button
        size="lg"
        className="h-20 w-full bg-emerald-600 text-2xl font-semibold text-white hover:bg-emerald-700"
        onClick={onClose}
        disabled={saving}
      >
        <Icon
          name={saving ? 'Loader2' : 'Check'}
          size={30}
          className={`mr-3 ${saving ? 'animate-spin' : ''}`}
        />
        Закрыть рулон
      </Button>
      {/* Брак в начале полотна: рулон отставляем целиком, а не режем дальше. */}
      <Button
        variant="outline"
        size="lg"
        className="h-20 w-full border-destructive/40 text-2xl font-semibold text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setDefectOpen(true)}
        disabled={saving}
      >
        <Icon name="PackageX" size={28} className="mr-3" />
        Бракованный рулон
      </Button>
      <Button
        variant="outline"
        size="lg"
        className="h-16 w-full text-xl"
        onClick={onCancel}
      >
        Отмена
      </Button>

      <KioskRollDefectDialog
        open={defectOpen}
        onOpenChange={setDefectOpen}
        barcode={selected.barcode}
        initialQuantity={selected.initialQuantity}
        remainingQuantity={selected.remainingQuantity}
        unit={selected.unit}
        defectReason={defectReason}
        setDefectReason={setDefectReason}
        saving={saving}
        onConfirm={onFlagDefect}
      />
    </CardContent>
  </Card>
);

export default KioskRollCloseCard;