import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import KioskNumPad from '@/components/crm/kiosk/KioskNumPad';
import KioskRollDefectDialog from '@/components/crm/kiosk/KioskRollDefectDialog';
import type { Roll } from '@/lib/rollsApi';
import { formatQuantity } from '@/lib/formatQuantity';

interface KioskRollCloseCardProps {
  selected: Roll;
  shortage: string;
  setShortage: (value: string) => void;
  saving: boolean;
  /** Сколько метров МОГЛО не хватить с учётом уже израсходованного на заказы. */
  maxPossibleShortage: number | null;
  /** Заявленная недостача невозможна — кнопка закрытия гасится. */
  shortageTooBig: boolean;
  onClose: (withShortage: boolean) => void;
  onCancel: () => void;
  defectOpen: boolean;
  setDefectOpen: (open: boolean) => void;
  defectReason: string;
  setDefectReason: (value: string) => void;
  onFlagDefect: () => void;
}

/** Карточка выбранного рулона: остаток, ввод недостачи цифровой клавиатурой,
 * закрытие рулона и отставление бракованного. */
const KioskRollCloseCard = ({
  selected,
  shortage,
  setShortage,
  saving,
  maxPossibleShortage,
  shortageTooBig,
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

      {/* Остаток крупно и рядом с полем ввода: закройщик указывает недостачу,
          глядя на то, сколько метров числится на рулоне. Раньше остаток был
          мелкой строкой в шапке, и в поле улетали цифры вроде 90 м при остатке 5. */}
      <div className="rounded-md border-2 border-border bg-muted/40 p-3 text-center">
        <p className="text-lg text-muted-foreground">По системе на рулоне осталось</p>
        <p className="font-mono-tech text-5xl font-bold">
          {formatQuantity(selected.remainingQuantity)} {selected.unit}
        </p>
      </div>

      {/* Сколько уже ушло в сшитые вещи. Это твёрдый факт: система записала расход
          по каждому заказу. Показываем рядом с остатком, чтобы человек видел всю
          картину по рулону, а не только конечную цифру. */}
      {selected.usedQuantity != null && selected.usedQuantity > 0 && (
        <div className="rounded-md border border-border bg-muted/20 p-3 text-center">
          <p className="text-lg text-muted-foreground">Уже израсходовано на заказы</p>
          <p className="font-mono-tech text-3xl font-bold">
            {formatQuantity(selected.usedQuantity)} {selected.unit}
          </p>
          <p className="mt-1 text-lg text-muted-foreground">
            из {formatQuantity(selected.initialQuantity)} {selected.unit} в рулоне
          </p>
        </div>
      )}

      <div className="rounded-md border border-border p-3 text-center">
        <p className="text-lg text-muted-foreground">Недостача (если материал закончился раньше)</p>
        <p className="font-mono-tech text-5xl font-bold">{shortage || '0'}</p>
        {/* Больше остатка списать нельзя — предупреждаем сразу, до нажатия кнопки. */}
        {Number(shortage) > Number(selected.remainingQuantity || 0) && (
          <p className="mt-1 text-lg font-semibold text-destructive">
            Больше, чем осталось на рулоне — проверьте цифру
          </p>
        )}
        {/* Проверка по фактическому расходу: столько метров физически не могло
            не хватить, потому что они уже ушли в сшитые вещи. */}
        {maxPossibleShortage != null &&
          Number(shortage) > maxPossibleShortage &&
          Number(shortage) <= Number(selected.remainingQuantity || 0) && (
            <p className="mt-1 text-lg font-semibold text-destructive">
              Не хватать могло максимум {formatQuantity(maxPossibleShortage)} {selected.unit}:
              остальное уже ушло в заказы
            </p>
          )}
      </div>

      <KioskNumPad value={shortage} onChange={setShortage} />

      <Button
        size="lg"
        className="h-20 w-full bg-emerald-600 text-2xl font-semibold text-white hover:bg-emerald-700"
        onClick={() => onClose(true)}
        disabled={saving || shortageTooBig}
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
        defectReason={defectReason}
        setDefectReason={setDefectReason}
        saving={saving}
        onConfirm={onFlagDefect}
      />
    </CardContent>
  </Card>
);

export default KioskRollCloseCard;
