import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { KioskShift } from '@/lib/kioskApi';

interface Props {
  shift: KioskShift | null;
  shiftSaving: boolean;
  /** Время, раньше которого смену закрыть нельзя. */
  closeAt: Date | null;
  canCloseNow: boolean;
  onOpenShift: (workshopId: number | null, shiftNumber: number | null) => void;
  onCloseShiftClick: () => void;
}

/**
 * Экран смены: одна большая кнопка — открыть или закрыть.
 *
 * Пока рабочее время не вышло, закрытие недоступно и на экране стоит час, в
 * который смену можно будет сдать. Досрочно закрывает только администратор.
 */
const KioskShiftScreen = ({
  shift,
  shiftSaving,
  closeAt,
  canCloseNow,
  onOpenShift,
  onCloseShiftClick,
}: Props) => (
  <div className="mx-auto max-w-xl space-y-4">
    {shift?.isOpen ? (
      <>
        {/* Пока рабочее время не вышло, кнопка неактивна и показывает, когда
            смену можно будет закрыть. Досрочно закрывает только администратор. */}
        {closeAt && !canCloseNow && (
          <div className="rounded-md border border-border p-4 text-center">
            <p className="text-muted-foreground">Смену можно закрыть в</p>
            <p className="font-mono-tech text-4xl font-bold">
              {/* Строго по Москве: это время сотрудник сверяет со стенными
                  часами в цехе, и расхождение он замечает сразу. */}
              {closeAt.toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Europe/Moscow',
              })}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Раньше смену закроет только администратор
            </p>
          </div>
        )}
        <Button
          size="lg"
          variant="destructive"
          className="h-20 w-full text-xl"
          onClick={onCloseShiftClick}
          disabled={shiftSaving || !canCloseNow}
        >
          <Icon
            name={shiftSaving ? 'Loader2' : 'LogOut'}
            size={28}
            className={`mr-2 ${shiftSaving ? 'animate-spin' : ''}`}
          />
          Закрыть смену
        </Button>
      </>
    ) : (
      <Button
        size="lg"
        className="h-20 w-full bg-emerald-600 text-xl text-white hover:bg-emerald-700"
        onClick={() => onOpenShift(null, null)}
        disabled={shiftSaving}
      >
        <Icon
          name={shiftSaving ? 'Loader2' : 'Play'}
          size={28}
          className={`mr-2 ${shiftSaving ? 'animate-spin' : ''}`}
        />
        Открыть смену
      </Button>
    )}
  </div>
);

export default KioskShiftScreen;
