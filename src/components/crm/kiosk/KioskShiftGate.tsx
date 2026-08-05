import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import KioskIdleTimer from '@/components/crm/kiosk/KioskIdleTimer';
import type { KioskUser, KioskShift } from '@/lib/kioskApi';

interface KioskShiftGateProps {
  user: KioskUser;
  shift: KioskShift | null;
  workshopId: string | undefined;
  shiftSaving: boolean;
  onEnterMenu: () => void;
  onOpenShift: () => void;
  onLogout: () => void;
}

/** Первый экран после скана QR: открытие смены. В меню терминала пускаем только после того,
 * как сотрудник открыл смену и нажал «Войти в терминал». */
const KioskShiftGate = ({
  user,
  shift,
  workshopId,
  shiftSaving,
  onEnterMenu,
  onOpenShift,
  onLogout,
}: KioskShiftGateProps) => {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <KioskIdleTimer onTimeout={onLogout} />
      <div className="w-full max-w-xl space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Приветствую, {user.name}!</h1>
          <p className="mt-2 text-lg text-muted-foreground">Цех №{workshopId}</p>
        </div>

        <div className="flex items-center justify-center gap-2">
          <span className="text-muted-foreground">Смена:</span>
          {shift?.isOpen ? (
            <Badge className="bg-emerald-600 text-base text-white hover:bg-emerald-600">
              Открыта{shift.shiftNumber != null ? ` · №${shift.shiftNumber}` : ''}
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-base">
              Закрыта
            </Badge>
          )}
        </div>

        {shift?.isOpen ? (
          // Закрытие смены доступно внутри терминала (плитка «Открытие / Закрытие смены»),
          // поэтому здесь только вход.
          <Button
            size="lg"
            className="h-20 w-full bg-blue-600 text-xl text-white hover:bg-blue-700"
            onClick={onEnterMenu}
          >
            <Icon name="LayoutGrid" size={28} className="mr-2" />
            Войти в терминал
          </Button>
        ) : (
          <Button
            size="lg"
            className="h-20 w-full bg-emerald-600 text-xl text-white hover:bg-emerald-700"
            onClick={onOpenShift}
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

        <Button variant="outline" size="lg" className="h-14 w-full" onClick={onLogout}>
          Выход
        </Button>
      </div>
    </div>
  );
};

export default KioskShiftGate;
