import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import KioskIdleTimer from '@/components/crm/kiosk/KioskIdleTimer';
import {
  fetchOpenShiftOptions,
  type KioskUser,
  type KioskShift,
  type OpenShiftWorkshop,
} from '@/lib/kioskApi';

interface KioskShiftGateProps {
  user: KioskUser;
  shift: KioskShift | null;
  workshopId: string | undefined;
  shiftSaving: boolean;
  onEnterMenu: () => void;
  /** Открыть смену в выбранном цехе и смене. */
  onOpenShift: (workshopId: number | null, shiftNumber: number | null) => void;
  onLogout: () => void;
}

/** Первый экран после скана QR: открытие смены. В меню терминала пускаем только после того,
 * как сотрудник открыл смену и нажал «Войти в терминал».
 *
 * Цех и смену сотрудник выбирает сам: швея, закройщик и упаковщица работают гибко и могут
 * выйти в любой цех, а не только в свой. По умолчанию подставляем цех этого терминала —
 * в обычный день достаточно просто нажать «Открыть смену».
 */
const KioskShiftGate = ({
  user,
  shift,
  workshopId,
  shiftSaving,
  onEnterMenu,
  onOpenShift,
  onLogout,
}: KioskShiftGateProps) => {
  const [workshops, setWorkshops] = useState<OpenShiftWorkshop[]>([]);
  const [selectedWorkshop, setSelectedWorkshop] = useState<number | null>(
    Number(workshopId) || null
  );
  const [selectedShift, setSelectedShift] = useState<number | null>(null);

  useEffect(() => {
    if (shift?.isOpen) return;
    fetchOpenShiftOptions()
      .then((list) => {
        setWorkshops(list);
        // Цех терминала — самый частый вариант, подставляем его сразу.
        const fallback = Number(workshopId) || list[0]?.id || null;
        const current = list.find((w) => w.id === fallback) || list[0];
        setSelectedWorkshop(current?.id ?? null);
        // Смену сотрудника подставляем, если она есть среди активных в этом цехе.
        const shifts = current?.shifts || [];
        setSelectedShift(
          user.shiftFromCode && shifts.includes(user.shiftFromCode)
            ? user.shiftFromCode
            : (shifts[0] ?? null)
        );
      })
      .catch(() => setWorkshops([]));
  }, [shift?.isOpen, workshopId, user.shiftFromCode]);

  const currentWorkshop = workshops.find((w) => w.id === selectedWorkshop);
  const availableShifts = currentWorkshop?.shifts || [];
  const isGuestChoice = !!(
    user.homeWorkshopId &&
    selectedWorkshop &&
    user.homeWorkshopId !== selectedWorkshop
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <KioskIdleTimer onTimeout={onLogout} />
      <div className="w-full max-w-xl space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">Приветствую, {user.name}!</h1>
          <p className="mt-2 text-lg text-muted-foreground">
            {currentWorkshop?.name || `Цех №${workshopId}`}
          </p>
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
          <>
            {workshops.length > 1 && (
              <div className="space-y-2">
                <p className="text-center text-base text-muted-foreground">Цех</p>
                <div className="grid grid-cols-2 gap-2">
                  {workshops.map((w) => (
                    <Button
                      key={w.id}
                      variant={selectedWorkshop === w.id ? 'default' : 'outline'}
                      className="h-16 text-lg"
                      onClick={() => {
                        setSelectedWorkshop(w.id);
                        setSelectedShift(w.shifts[0] ?? null);
                      }}
                    >
                      {w.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {availableShifts.length > 1 && (
              <div className="space-y-2">
                <p className="text-center text-base text-muted-foreground">Смена</p>
                <div className="grid grid-cols-3 gap-2">
                  {availableShifts.map((n) => (
                    <Button
                      key={n}
                      variant={selectedShift === n ? 'default' : 'outline'}
                      className="h-16 text-lg"
                      onClick={() => setSelectedShift(n)}
                    >
                      №{n}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {isGuestChoice && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                <Icon name="Info" size={18} className="mt-0.5 shrink-0" />
                <p className="text-base">
                  Вы выходите в чужой цех как гость. Работать можно как обычно, но списать
                  брак здесь сможет только штатный сотрудник этого цеха.
                </p>
              </div>
            )}

            <Button
              size="lg"
              className="h-20 w-full bg-emerald-600 text-xl text-white hover:bg-emerald-700"
              onClick={() => onOpenShift(selectedWorkshop, selectedShift)}
              disabled={shiftSaving}
            >
              <Icon
                name={shiftSaving ? 'Loader2' : 'Play'}
                size={28}
                className={`mr-2 ${shiftSaving ? 'animate-spin' : ''}`}
              />
              Открыть смену
            </Button>
          </>
        )}

        <Button variant="outline" size="lg" className="h-14 w-full" onClick={onLogout}>
          Выход
        </Button>
      </div>
    </div>
  );
};

export default KioskShiftGate;
