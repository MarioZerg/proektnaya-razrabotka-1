import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import KioskMenu, { type KioskScreen } from '@/components/crm/kiosk/KioskMenu';
import KioskDefectWriteoffPanel from '@/components/crm/kiosk/KioskDefectWriteoffPanel';
import KioskOrdersScreen from '@/components/crm/kiosk/KioskOrdersScreen';
import KioskRepackScreen from '@/components/crm/kiosk/KioskRepackScreen';
import KioskFlyerStickersScreen from '@/components/crm/kiosk/KioskFlyerStickersScreen';
import KioskReviewsScreen from '@/components/crm/kiosk/KioskReviewsScreen';
import KioskRollsScreen from '@/components/crm/kiosk/KioskRollsScreen';
import KioskUnlabeledScreen from '@/components/crm/kiosk/KioskUnlabeledScreen';
import KioskShiftScreen from '@/components/crm/kiosk/KioskShiftScreen';
import type { Role } from '@/lib/roles';
import type { KioskUser, KioskShift } from '@/lib/kioskApi';

interface Props {
  user: KioskUser;
  shift: KioskShift | null;
  workshopId: string | undefined;
  currentWorkshopId: number | null;
  isGuestInWorkshop: boolean;
  isPreview: boolean;
  screen: KioskScreen;
  setScreen: (screen: KioskScreen) => void;
  shiftSaving: boolean;
  repackCount: number;
  closeAt: Date | null;
  canCloseNow: boolean;
  onOpenShift: (workshopId: number | null, shiftNumber: number | null) => void;
  onCloseShiftClick: () => void;
}

/**
 * Содержимое выбранного раздела терминала.
 *
 * Каждый экран получает свою ширину: заказы и рулоны — во всю ширину планшета,
 * остальное узкой колонкой. Упаковщица смотрит на экран с расстояния вытянутой
 * руки, и карточка заказа в узкой колонке вытягивалась в длинную «простыню».
 */
const KioskScreenRouter = ({
  user,
  shift,
  workshopId,
  currentWorkshopId,
  isGuestInWorkshop,
  isPreview,
  screen,
  setScreen,
  shiftSaving,
  repackCount,
  closeAt,
  canCloseNow,
  onOpenShift,
  onCloseShiftClick,
}: Props) => (
  <div className="p-4">
    {/* Плитки разделов доступны только на открытой смене: пока смена не начата,
        работать на терминале нельзя — иначе заказы и брак попадут в систему без
        привязки к смене, и по ним не начислится зарплата. Показываем одну кнопку
        открытия смены. В режиме проверки админ смотрит терминал без ограничений. */}
    {screen === 'menu' &&
      (shift?.isOpen || isPreview ? (
        /* Плитки меню — по должности СМЕНЫ: вышла швеёй, значит и разделы швеи. */
        <KioskMenu
          onSelect={setScreen}
          role={(shift?.role || user.role) as Role}
          repackCount={repackCount}
        />
      ) : (
        <div className="mx-auto max-w-xl space-y-4 pt-8 text-center">
          <Icon name="Clock" size={56} className="mx-auto text-muted-foreground" />
          <p className="text-2xl font-bold">Смена не открыта</p>
          <p className="text-muted-foreground">
            Откройте смену — после этого станут доступны заказы, рулоны и остальные
            разделы
          </p>
          <Button
            size="lg"
            className="h-20 w-full bg-emerald-600 text-xl text-white hover:bg-emerald-700"
            onClick={() => setScreen('shift')}
          >
            <Icon name="Play" size={28} className="mr-2" />
            Открыть смену
          </Button>
        </div>
      ))}

    {screen === 'shift' && (
      <KioskShiftScreen
        shift={shift}
        shiftSaving={shiftSaving}
        closeAt={closeAt}
        canCloseNow={canCloseNow}
        onOpenShift={onOpenShift}
        onCloseShiftClick={onCloseShiftClick}
      />
    )}

    {/* Заказ раскрываем на всю ширину планшета, а не узкой колонкой: упаковщица
        смотрит на экран с расстояния вытянутой руки, и при max-w-xl карточка
        вытягивалась в длинную «простыню» — половину строк приходилось листать. */}
    {screen === 'orders' && (
      <div className="mx-auto max-w-5xl">
        <KioskOrdersScreen
          packerId={user.id}
          packerName={user.name}
          workshopId={currentWorkshopId}
          // Должность берём из СМЕНЫ: сотрудник мог выйти сегодня другой ролью.
          role={shift?.role || user.role}
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
        <KioskRepackScreen
          actorId={user.id}
          actorName={user.name}
          // Цех киоска: список перепаковки у каждого цеха свой, иначе две
          // упаковщицы возьмут в работу одну и ту же вещь.
          workshopId={currentWorkshopId || Number(workshopId) || null}
        />
      </div>
    )}

    {screen === 'flyer' && (
      <div className="mx-auto max-w-4xl">
        <KioskFlyerStickersScreen onBack={() => setScreen('menu')} />
      </div>
    )}

    {screen === 'unlabeled' && (
      <div className="mx-auto max-w-3xl">
        <KioskUnlabeledScreen actorId={user.id} actorName={user.name} />
      </div>
    )}

    {screen === 'defect' && (
      <div className="mx-auto max-w-5xl space-y-4">
        {shift?.isOpen ? (
          <KioskDefectWriteoffPanel
            workshopId={currentWorkshopId || Number(workshopId) || 1}
            isGuest={isGuestInWorkshop}
            role={shift?.role || user.role}
            userId={user.id}
            userName={user.name}
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

    {/* Рулоны и брак — тоже во всю ширину: в списке рулонов длинные названия
        материалов и штрихкоды, в узкой колонке они переносились по три строки. */}
    {screen === 'rolls' && (
      <div className="mx-auto max-w-5xl">
        <KioskRollsScreen
          workshopId={Number(workshopId) || 1}
          shiftNumber={shift?.shiftNumber ?? user.shiftFromCode ?? null}
          userId={user.id}
          userName={user.name}
          role={shift?.role || user.role}
        />
      </div>
    )}
  </div>
);

export default KioskScreenRouter;
