import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { clearAppCache } from '@/lib/appUpdate';
import KioskMenu, { type KioskScreen } from '@/components/crm/kiosk/KioskMenu';
import KioskDefectWriteoffPanel from '@/components/crm/kiosk/KioskDefectWriteoffPanel';
import KioskOrdersScreen from '@/components/crm/kiosk/KioskOrdersScreen';
import KioskRepackScreen from '@/components/crm/kiosk/KioskRepackScreen';
import KioskReviewsScreen from '@/components/crm/kiosk/KioskReviewsScreen';
import KioskRollsScreen from '@/components/crm/kiosk/KioskRollsScreen';
import KioskUnlabeledScreen from '@/components/crm/kiosk/KioskUnlabeledScreen';
import KioskIdleTimer from '@/components/crm/kiosk/KioskIdleTimer';
import KioskDefectCheckDialog from '@/components/crm/kiosk/KioskDefectCheckDialog';
import { roleLabels, type Role } from '@/lib/roles';
import { fetchRepackCount, type KioskUser, type KioskShift } from '@/lib/kioskApi';
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
  /** Данные об опоздании — показываем во весь экран сразу после открытия смены. */
  lateInfo: { minutes: number; penalty: number; start: string | null } | null;
  onDismissLate: () => void;
  onLogout: () => void;
  /** Открыть смену. Внутри терминала цех и смена уже известны — передаём null,
   * и они берутся те же, что при входе. */
  onOpenShift: (workshopId: number | null, shiftNumber: number | null) => void;
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
  lateInfo,
  onDismissLate,
  onLogout,
  onOpenShift,
  onCloseShift,
  onCloseShiftClick,
}: KioskWorkspaceProps) => {
  // Раз в полминуты сверяем текущее время с разрешённым: как только смена отработана,
  // кнопка закрытия включается сама — сотруднику не нужно перезаходить в терминал.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const closeAt = shift?.canCloseAt ? new Date(shift.canCloseAt) : null;
  const canCloseNow = !closeAt || now >= closeAt.getTime();

  // Сколько вещей ждёт перепаковки в этом цехе — число на плитке меню.
  //
  // Обновляем при каждом возврате в меню: упаковщица закрыла вещь и вернулась —
  // счётчик уже новый. Считаем только СВОЙ цех, иначе киоски цехов №1 и №2 покажут
  // одно и то же число и обе упаковщицы пойдут за одними вещами.
  const [repackCount, setRepackCount] = useState(0);
  const repackWorkshop = currentWorkshopId || Number(workshopId) || null;
  useEffect(() => {
    if (screen !== 'menu') return;
    let alive = true;
    fetchRepackCount(repackWorkshop).then((r) => {
      if (alive) setRepackCount(r.mineCount + r.freeCount);
    });
    return () => {
      alive = false;
    };
  }, [screen, repackWorkshop]);

  return (
    <div className="kiosk-root min-h-screen bg-background">
      {/* Автовыход из профиля при бездействии: предупреждение через минуту, отсчёт 30 сек.
          В режиме проверки таймер не нужен — админ может спокойно изучать экраны. */}
      {!isPreview && <KioskIdleTimer onTimeout={onLogout} />}

      {/* Опоздание. Смену открыть дали — работа важнее, но человек должен увидеть,
          на сколько опоздал и что за это удержано. Во весь экран: на планшете в цеху
          маленькое уведомление легко пропустить. */}
      {lateInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-lg space-y-4 rounded-lg bg-background p-6 text-center">
            <Icon name="Clock" size={48} className="mx-auto text-amber-600" />
            <p className="text-2xl font-bold">Вы опоздали</p>
            <p className="font-mono-tech text-5xl font-bold text-amber-600">
              {lateInfo.minutes >= 60
                ? `${Math.floor(lateInfo.minutes / 60)} ч ${lateInfo.minutes % 60} мин`
                : `${lateInfo.minutes} мин`}
            </p>
            {lateInfo.start && (
              <p className="text-base text-muted-foreground">
                Смена начинается в {lateInfo.start}
              </p>
            )}
            {lateInfo.penalty > 0 && (
              <p className="text-lg font-medium">
                Удержано {lateInfo.penalty.toLocaleString('ru-RU')} ₽
              </p>
            )}
            <Button size="lg" className="h-16 w-full text-lg" onClick={onDismissLate}>
              Понятно, начать работу
            </Button>
          </div>
        </div>
      )}

      {/* Смену не дали закрыть: за швеёй или закройщиком ещё числятся заказы, а у
          упаковщицы не разобрана очередь стикеровки по цеху. Показываем это во весь
          экран — на планшете в цеху всплывашку легко не заметить. */}
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
        {/* Кнопки прижаты вправо, но на узком планшете переносятся вниз целой
            группой, а не по одной — иначе «Выход» уезжал в другой ряд и попадал
            под палец при попытке нажать «В меню». */}
        <div className="ml-auto flex flex-wrap gap-2">
          {screen !== 'menu' && (
            <Button variant="outline" onClick={() => setScreen('menu')}>
              <Icon name="ArrowLeft" size={20} className="mr-1.5" />
              В меню
            </Button>
          )}
          {/* Планшет в цехе не закрывается сутками и может держать старую
              версию системы. Кнопка стирает сохранённые копии и загружает
              свежую версию — без похода в настройки браузера. */}
          <Button
            variant="outline"
            title="Загрузить свежую версию системы"
            onClick={() => {
              void clearAppCache();
            }}
          >
            <Icon name="RefreshCw" size={16} className="mr-1.5" />
            Обновить
          </Button>
          <Button variant="destructive" onClick={isPreview ? () => window.close() : onLogout}>
            {isPreview ? 'Закрыть проверку' : 'Выход'}
          </Button>
        </div>
      </div>

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
          <div className="mx-auto max-w-xl space-y-4">
            {shift?.isOpen ? (
              <>
                {/* Пока рабочее время не вышло, кнопка неактивна и показывает, когда
                    смену можно будет закрыть. Досрочно закрывает только администратор. */}
                {closeAt && !canCloseNow && (
                  <div className="rounded-md border border-border p-4 text-center">
                    <p className="text-muted-foreground">Смену можно закрыть в</p>
                    <p className="font-mono-tech text-4xl font-bold">
                      {closeAt.toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit',
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
        )}

        {screen === 'orders' && (
          <div className="mx-auto max-w-xl">
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

        {screen === 'rolls' && (
          <div className="mx-auto max-w-xl">
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
    </div>
  );
};

export default KioskWorkspace;