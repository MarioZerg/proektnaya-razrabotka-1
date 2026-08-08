import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import KioskMenu, { type KioskScreen } from '@/components/crm/kiosk/KioskMenu';
import KioskDefectWriteoffPanel from '@/components/crm/kiosk/KioskDefectWriteoffPanel';
import KioskOrdersScreen from '@/components/crm/kiosk/KioskOrdersScreen';
import KioskRepackScreen from '@/components/crm/kiosk/KioskRepackScreen';
import KioskReviewsScreen from '@/components/crm/kiosk/KioskReviewsScreen';
import KioskRollsScreen from '@/components/crm/kiosk/KioskRollsScreen';
import KioskUnlabeledScreen from '@/components/crm/kiosk/KioskUnlabeledScreen';
import KioskDefectReceiveScreen from '@/components/crm/kiosk/KioskDefectReceiveScreen';
import KioskIdleTimer from '@/components/crm/kiosk/KioskIdleTimer';
import KioskDefectCheckDialog from '@/components/crm/kiosk/KioskDefectCheckDialog';
import { roleLabels, type Role } from '@/lib/roles';
import type { KioskUser, KioskShift } from '@/lib/kioskApi';
import type { DefectCheck } from '@/lib/shiftSessionsApi';

interface KioskWorkspaceProps {
  user: KioskUser;
  shift: KioskShift | null;
  workshopId: string | undefined;
  currentWorkshopId: number | null;
  isGuestInWorkshop: boolean;
  isPreview: boolean;
  screen: KioskScreen;
  setScreen: (screen: KioskScreen) => void;
  shiftSaving: boolean;
  defectCheck: DefectCheck | null;
  setDefectCheck: (check: DefectCheck | null) => void;
  /** Сообщение о том, что смену нельзя закрыть из-за незавершённых заказов. */
  closeBlocked: string;
  onDismissCloseBlocked: () => void;
  onLogout: () => void;
  onOpenShift: () => void;
  onCloseShift: () => void;
  onCloseShiftClick: () => void;
}

/** Рабочая область терминала после входа: шапка с данными сотрудника и содержимое
 * выбранного экрана — меню плиток, смена, заказы, рулоны, брак и остальные разделы. */
const KioskWorkspace = ({
  user,
  shift,
  workshopId,
  currentWorkshopId,
  isGuestInWorkshop,
  isPreview,
  screen,
  setScreen,
  shiftSaving,
  defectCheck,
  setDefectCheck,
  closeBlocked,
  onDismissCloseBlocked,
  onLogout,
  onOpenShift,
  onCloseShift,
  onCloseShiftClick,
}: KioskWorkspaceProps) => {
  return (
    <div className="min-h-screen bg-background">
      {/* Автовыход из профиля при бездействии: предупреждение через минуту, отсчёт 30 сек.
          В режиме проверки таймер не нужен — админ может спокойно изучать экраны. */}
      {!isPreview && <KioskIdleTimer onTimeout={onLogout} />}

      {/* Смену не дали закрыть: за швеёй или закройщиком ещё числятся заказы. Показываем
          это во весь экран — на планшете в цеху всплывашку легко не заметить. */}
      {closeBlocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-lg space-y-4 rounded-lg bg-background p-6">
            <div className="flex items-start gap-3">
              <Icon name="TriangleAlert" size={32} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <p className="text-2xl font-bold">Смену закрыть нельзя</p>
                <p className="mt-1 text-base text-muted-foreground">{closeBlocked}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="lg"
                className="h-16 flex-1 text-lg"
                onClick={() => {
                  onDismissCloseBlocked();
                  setScreen('orders');
                }}
              >
                <Icon name="ClipboardList" size={22} className="mr-2" />
                Мои заказы
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-16 flex-1 text-lg"
                onClick={onDismissCloseBlocked}
              >
                Понятно
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Напоминание про брак перед закрытием смены. Текст свой для каждой роли:
          закройщику про ткань, швее про тесьму — так вопрос попадает в её работу. */}
      {defectCheck && (
        <KioskDefectCheckDialog
          defectCheck={defectCheck}
          shiftSaving={shiftSaving}
          onGoToDefect={() => {
            setDefectCheck(null);
            setScreen('defect');
          }}
          onCloseShift={onCloseShift}
        />
      )}

      <div
        className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
          isPreview ? 'bg-violet-100' : 'bg-emerald-100'
        }`}
      >
        {isPreview && (
          <Badge className="bg-violet-600 text-base text-white hover:bg-violet-600">
            <Icon name="Eye" size={14} className="mr-1.5" />
            Режим проверки · {roleLabels[user.role as Role] || user.role}
            {user.id ? ' · реальные данные' : ''}
          </Badge>
        )}
        <p
          className={`text-xl font-semibold ${
            isPreview ? 'text-violet-900' : 'text-emerald-900'
          }`}
        >
          Приветствую, {user.name}!
        </p>
        <Badge variant="secondary" className="text-base">
          Цех №{workshopId}
        </Badge>
        {shift?.isOpen ? (
          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Смена открыта</Badge>
        ) : (
          <Badge variant="secondary">Смена закрыта</Badge>
        )}
        <div className="ml-auto flex gap-2">
          {screen !== 'menu' && (
            <Button variant="outline" onClick={() => setScreen('menu')}>
              <Icon name="ArrowLeft" size={16} className="mr-1.5" />
              В меню
            </Button>
          )}
          <Button variant="destructive" onClick={isPreview ? () => window.close() : onLogout}>
            {isPreview ? 'Закрыть проверку' : 'Выход'}
          </Button>
        </div>
      </div>

      <div className="p-4">
        {screen === 'menu' && <KioskMenu onSelect={setScreen} role={user.role as Role} />}

        {screen === 'shift' && (
          <div className="mx-auto max-w-xl space-y-4">
            {shift?.isOpen ? (
              <Button
                size="lg"
                variant="destructive"
                className="h-20 w-full text-xl"
                onClick={onCloseShiftClick}
                disabled={shiftSaving}
              >
                <Icon
                  name={shiftSaving ? 'Loader2' : 'LogOut'}
                  size={28}
                  className={`mr-2 ${shiftSaving ? 'animate-spin' : ''}`}
                />
                Закрыть смену
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
          </div>
        )}

        {screen === 'orders' && (
          <div className="mx-auto max-w-xl">
            <KioskOrdersScreen
              packerId={user.id}
              packerName={user.name}
              workshopId={currentWorkshopId}
              role={user.role}
            />
          </div>
        )}

        {screen === 'reviews' && (
          <div className="mx-auto max-w-3xl">
            <KioskReviewsScreen />
          </div>
        )}

        {screen === 'repack' && (
          <div className="mx-auto max-w-3xl">
            <KioskRepackScreen actorId={user.id} actorName={user.name} />
          </div>
        )}

        {screen === 'unlabeled' && (
          <div className="mx-auto max-w-3xl">
            <KioskUnlabeledScreen actorId={user.id} actorName={user.name} />
          </div>
        )}

        {screen === 'defect' && (
          <div className="mx-auto max-w-xl space-y-4">
            {shift?.isOpen ? (
              <KioskDefectWriteoffPanel
                workshopId={currentWorkshopId || Number(workshopId) || 1}
                isGuest={isGuestInWorkshop}
                role={user.role}
              />
            ) : (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
                <p className="text-lg font-bold">Смена не открыта</p>
                <p className="mt-1 text-base">
                  Брак оформляется в рамках смены — сначала откройте её
                </p>
              </div>
            )}
          </div>
        )}

        {screen === 'defect-receive' && (
          <div className="mx-auto max-w-3xl">
            <KioskDefectReceiveScreen actorId={user.id} actorName={user.name} />
          </div>
        )}

        {screen === 'rolls' && (
          <div className="mx-auto max-w-xl">
            <KioskRollsScreen
              workshopId={Number(workshopId) || 1}
              shiftNumber={shift?.shiftNumber ?? user.shiftFromCode ?? null}
              userId={user.id}
              userName={user.name}
              role={user.role}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default KioskWorkspace;