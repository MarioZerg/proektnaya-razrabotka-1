import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { DefectCheck } from '@/lib/shiftSessionsApi';

interface KioskDefectCheckDialogProps {
  defectCheck: DefectCheck;
  shiftSaving: boolean;
  onGoToDefect: () => void;
  onCloseShift: () => void;
}

/** Напоминание про брак перед закрытием смены. Текст свой для каждой роли:
 * закройщику про ткань, швее про тесьму — так вопрос попадает в её работу. */
const KioskDefectCheckDialog = ({
  defectCheck,
  shiftSaving,
  onGoToDefect,
  onCloseShift,
}: KioskDefectCheckDialogProps) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-lg space-y-4 rounded-lg bg-background p-6">
        <div className="flex items-start gap-3">
          <Icon name="TriangleAlert" size={32} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            <p className="text-2xl font-bold">{defectCheck.question}</p>
            <p className="mt-1 text-base text-muted-foreground">{defectCheck.hint}</p>
          </div>
        </div>

        <div
          className={`rounded-md border p-3 text-base ${
            defectCheck.defectsCount > 0
              ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
              : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {defectCheck.defectsCount > 0
            ? `За смену вы оформили брака: ${defectCheck.defectsCount} шт. на ${defectCheck.defectsQuantity} пог.м.`
            : 'За эту смену вы не оформили ни одного брака'}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="lg"
            variant="outline"
            className="h-16 flex-1 text-lg"
            onClick={onGoToDefect}
          >
            <Icon name="PackageX" size={22} className="mr-2" />
            Оформить брак
          </Button>
          <Button
            size="lg"
            variant="destructive"
            className="h-16 flex-1 text-lg"
            onClick={onCloseShift}
            disabled={shiftSaving}
          >
            <Icon name="LogOut" size={22} className="mr-2" />
            Всё закрыто, завершить смену
          </Button>
        </div>
      </div>
    </div>
  );
};

export default KioskDefectCheckDialog;
