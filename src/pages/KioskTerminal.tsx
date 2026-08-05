import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { kioskLoginByCode, type KioskUser, type KioskShift } from '@/lib/kioskApi';
import { openShift, closeShift, fetchEmployeeShifts } from '@/lib/shiftSessionsApi';
import { playScanSound, playScanErrorSound } from '@/lib/scanSound';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';
import KioskMenu, { type KioskScreen } from '@/components/crm/kiosk/KioskMenu';
import KioskDefectWriteoffPanel from '@/components/crm/kiosk/KioskDefectWriteoffPanel';
import KioskOrdersScreen from '@/components/crm/kiosk/KioskOrdersScreen';
import KioskRepackScreen from '@/components/crm/kiosk/KioskRepackScreen';
import KioskReviewsScreen from '@/components/crm/kiosk/KioskReviewsScreen';
import KioskRollsScreen from '@/components/crm/kiosk/KioskRollsScreen';
import KioskUnlabeledScreen from '@/components/crm/kiosk/KioskUnlabeledScreen';
import KioskIdleTimer from '@/components/crm/kiosk/KioskIdleTimer';
import { roleLabels, type Role } from '@/lib/roles';

/** Терминал цеха (киоск). Полноэкранный экран для планшета в цехе: сотрудник входит
 * сканированием личного QR-кода с бейджа (формат "{id}-{смена}-{дата}"), пароль не нужен.
 * Номер цеха берётся из адреса: /kiosk/1 — терминал первого цеха. */
const KioskTerminal = () => {
  const { workshopId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<KioskUser | null>(null);
  const [shift, setShift] = useState<KioskShift | null>(null);
  const [shiftSaving, setShiftSaving] = useState(false);
  const [screen, setScreen] = useState<KioskScreen>('menu');
  // После скана QR сотрудник сначала попадает на экран смены и только потом, нажав
  // «Войти в терминал», переходит в меню с плитками.
  const [enteredMenu, setEnteredMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Сканер может ввести чистый код (1-1-20260804) или всю ссылку из QR. Причём если на
  // терминале включена русская раскладка, латиница в ссылке превращается в кириллицу
  // ("barcode=" → "ифксцщву="), а цифры остаются целыми. Поэтому ищем в строке сам код по
  // шаблону "{id}-{смена}-{дата}" — это работает при любой раскладке и формате ввода.
  const extractCode = (raw: string): string => {
    const value = raw.trim();
    const byPattern = value.match(/(\d{1,6}-\d{1,3}-\d{6,8})/);
    if (byPattern) return byPattern[1];
    const byParam = value.match(/barcode=([^&\s]+)/i);
    if (byParam) return decodeURIComponent(byParam[1]);
    return value;
  };

  const loginWithCode = useCallback(
    async (rawValue: string) => {
      const value = extractCode(rawValue);
      if (!value) return;
      setCode('');
      if (inputRef.current) inputRef.current.value = '';
      setLoading(true);
      try {
        const data = await kioskLoginByCode(value);
        playScanSound();
        setUser(data.user);
        setShift(data.shift);
      } catch (e) {
        playScanErrorSound();
        toast({
          title: 'Не удалось войти',
          description: e instanceof Error ? e.message : undefined,
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [toast]
  );

  // Значение читаем прямо из поля: сканер вводит длинную строку очень быстро и может нажать
  // Enter раньше, чем React успеет положить последние символы в состояние — из состояния
  // тогда ушёл бы обрывок кода.
  const handleLogin = () => loginWithCode((inputRef.current?.value || code).trim());

  // Режим проверки для администратора: /kiosk/1?preview=1&role=sewer&name=Иван. Терминал
  // открывается глазами выбранной должности без сканирования QR и без открытия смены —
  // ничего не пишется в отчёты, админ просто смотрит, что видит сотрудник.
  const isPreview = searchParams.get('preview') === '1';
  useEffect(() => {
    if (!isPreview || user) return;
    const previewRole = searchParams.get('role') || 'sewer';
    const previewName = searchParams.get('name') || 'Проверка';
    // userId задан — админ смотрит терминал глазами конкретного сотрудника: экраны получат
    // его id, поэтому заказы, рулоны и смена будут настоящими, как у него на планшете.
    const previewUserId = Number(searchParams.get('userId')) || 0;
    setUser({
      id: previewUserId,
      name: previewName,
      role: previewRole,
      shiftFromCode: null,
      homeWorkshopId: Number(workshopId) || null,
    });
    setEnteredMenu(true);
    if (previewUserId) {
      // Подтягиваем настоящую смену сотрудника, чтобы админ видел терминал в том же
      // состоянии, что и работник: открыта смена или нет, какой цех и номер смены.
      fetchEmployeeShifts()
        .then((list) => {
          const found = list.find((e) => e.id === previewUserId);
          setShift({
            isOpen: !!found?.isOpen,
            openedAt: found?.openedAt ?? null,
            workshopId: found?.sessionWorkshopId ?? null,
            shiftNumber: found?.sessionShiftNumber ?? found?.shiftNumber ?? null,
          });
        })
        .catch(() =>
          setShift({ isOpen: false, openedAt: null, workshopId: null, shiftNumber: null }),
        );
    } else {
      setShift({ isOpen: false, openedAt: null, workshopId: null, shiftNumber: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview, user]);

  // Вход по ссылке из персонального QR сотрудника: /kiosk/1?barcode=3-20-20250513
  useEffect(() => {
    const barcode = searchParams.get('barcode');
    if (barcode && !user && !loading) {
      loginWithCode(barcode.trim());
      searchParams.delete('barcode');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Пауза больше обычной: из QR приходит длинная ссылка, ей нужно чуть больше времени,
  // чтобы сканер успел ввести её целиком до автоотправки.
  useScannerAutoSubmit(code, handleLogin, !loading && !user, 400);

  useEffect(() => {
    inputRef.current?.focus();
  }, [user]);

  const handleLogout = () => {
    setUser(null);
    setShift(null);
    setScreen('menu');
    setEnteredMenu(false);
    setCode('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Открытие/закрытие смены прямо на терминале: цех берётся из адреса киоска, смена — из
  // персонального QR-кода сотрудника (или из его профиля, если в коде её нет).
  const handleOpenShift = async () => {
    if (!user) return;
    // В режиме проверки смену не открываем: админ смотрит терминал, а не работает за него.
    if (isPreview) {
      toast({ title: 'Режим проверки', description: 'Смена не открывается — это только просмотр' });
      return;
    }
    setShiftSaving(true);
    try {
      const res = await openShift(user.id, Number(workshopId) || null, user.shiftFromCode ?? null);
      playScanSound();
      setShift({
        isOpen: true,
        openedAt: res.openedAt,
        workshopId: res.workshopId,
        shiftNumber: res.shiftNumber,
      });
      toast({
        title: 'Смена открыта',
        description: res.isLate ? 'Отмечено опоздание' : `Смена №${res.shiftNumber ?? '—'}`,
      });
    } catch (e) {
      playScanErrorSound();
      toast({
        title: 'Не удалось открыть смену',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setShiftSaving(false);
    }
  };

  // Сотрудник пришёл работать в чужой цех: списание брака здесь ему запрещено — это делает
  // штатный работник цеха, отсканировав свой штрихкод.
  const currentWorkshopId = shift?.workshopId ?? (Number(workshopId) || null);
  const isGuestInWorkshop = !!(
    user?.homeWorkshopId &&
    currentWorkshopId &&
    user.homeWorkshopId !== currentWorkshopId
  );

  const handleCloseShift = async () => {
    if (!user) return;
    if (isPreview) {
      toast({ title: 'Режим проверки', description: 'Смена не закрывается — это только просмотр' });
      return;
    }
    setShiftSaving(true);
    try {
      await closeShift(user.id);
      playScanSound();
      setShift({ isOpen: false, openedAt: null, workshopId: null, shiftNumber: null });
      // Смена закрыта — возвращаем сотрудника на стартовый экран терминала.
      setEnteredMenu(false);
      setScreen('menu');
      toast({ title: 'Смена закрыта' });
    } catch (e) {
      playScanErrorSound();
      toast({
        title: 'Не удалось закрыть смену',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setShiftSaving(false);
    }
  };

  // Первый экран после скана QR: открытие смены. В меню терминала пускаем только после того,
  // как сотрудник открыл смену и нажал «Войти в терминал».
  if (user && !enteredMenu) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
        <KioskIdleTimer onTimeout={handleLogout} />
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
              onClick={() => setEnteredMenu(true)}
            >
              <Icon name="LayoutGrid" size={28} className="mr-2" />
              Войти в терминал
            </Button>
          ) : (
            <Button
              size="lg"
              className="h-20 w-full bg-emerald-600 text-xl text-white hover:bg-emerald-700"
              onClick={handleOpenShift}
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

          <Button variant="outline" size="lg" className="h-14 w-full" onClick={handleLogout}>
            Выход
          </Button>
        </div>
      </div>
    );
  }

  // После входа сотрудник попадает в меню терминала с крупными плитками.
  if (user) {
    return (
      <div className="min-h-screen bg-background">
        {/* Автовыход из профиля при бездействии: предупреждение через минуту, отсчёт 30 сек.
            В режиме проверки таймер не нужен — админ может спокойно изучать экраны. */}
        {!isPreview && <KioskIdleTimer onTimeout={handleLogout} />}
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
            <Button variant="destructive" onClick={isPreview ? () => window.close() : handleLogout}>
              {isPreview ? 'Закрыть проверку' : 'Выход'}
            </Button>
          </div>
        </div>

        <div className="p-4">
          {screen === 'menu' && <KioskMenu onSelect={setScreen} role={user.role} />}

          {screen === 'shift' && (
            <div className="mx-auto max-w-xl space-y-4">
              {shift?.isOpen && (
                <KioskDefectWriteoffPanel
                  workshopId={currentWorkshopId || Number(workshopId) || 1}
                  isGuest={isGuestInWorkshop}
                />
              )}
              {shift?.isOpen ? (
                <Button
                  size="lg"
                  variant="destructive"
                  className="h-20 w-full text-xl"
                  onClick={handleCloseShift}
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
                  onClick={handleOpenShift}
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
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-xl space-y-6">
        <div className="text-center">
          <h1 className="text-4xl font-bold">Цех №{workshopId}</h1>
        </div>

        <div className="flex flex-col items-center gap-6 py-6">
          <Icon
            name={loading ? 'Loader2' : 'ScanLine'}
            size={72}
            className={`text-muted-foreground ${loading ? 'animate-spin' : ''}`}
          />
          <p className="text-center text-2xl font-semibold">
            {loading ? 'Проверяем код…' : 'Отсканируйте свой QR-код сотрудника'}
          </p>
          {/* Поле ввода скрыто: сканер печатает в него незаметно для сотрудника. */}
          <input
            ref={inputRef}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            onBlur={() => setTimeout(() => inputRef.current?.focus(), 50)}
            className="pointer-events-none absolute h-px w-px border-0 p-0 opacity-0"
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>
      </div>
    </div>
  );
};

export default KioskTerminal;