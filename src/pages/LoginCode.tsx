import { useEffect, useState } from 'react';
import LoginBackground from '@/components/auth/LoginBackground';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/lib/roles';
import {
  fetchMaxBotUrl,
  fetchMaxLoginStatus,
  verifyMaxCode,
  enterRole,
  type UserRoleEntry,
} from '@/lib/authApi';
import {
  getMaxLoginToken,
  setMaxLoginToken,
  clearMaxLoginToken,
} from '@/lib/maxLoginToken';
import RoleSelectScreen from '@/components/auth/RoleSelectScreen';
import PendingApprovalScreen from '@/components/auth/PendingApprovalScreen';

/**
 * Ввод кода из MAX — ОТДЕЛЬНАЯ страница со своим адресом (/login/code).
 *
 * Зачем отдельная, а не шаг на главной: чтобы получить код, человек уходит в мессенджер,
 * и страница входа выгружается. Раньше ввод кода был просто состоянием главной страницы —
 * вернувшись, сотрудник попадал на «Войти через MAX» и код вводить было некуда. Повторное
 * нажатие выдавало новый код, старый переставал подходить, и вход зацикливался.
 *
 * Собственный адрес это чинит: возврат системной кнопкой «назад», кнопкой мессенджера или
 * просто открытой рядом вкладкой ведёт ровно на форму ввода кода. Страницу можно открыть
 * заново в любой момент — код останется тем же.
 */
const LoginCode = () => {
  const navigate = useNavigate();
  const { login, user } = useAuth();

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<{
    id: number;
    name: string;
    phone: string | null;
    roles: UserRoleEntry[];
  } | null>(null);
  const [entering, setEntering] = useState(false);

  // Уже вошедшего уводим в систему: на эту страницу можно попасть по старой ссылке.
  useEffect(() => {
    if (user) navigate('/crm', { replace: true });
  }, [user, navigate]);

  // Вошли в соседней вкладке сайта (выбрали должность там) — эта вкладка тоже
  // переходит в систему, а не остаётся висеть на экране входа.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'megatul_user' && e.newValue) window.location.replace('/crm');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Метка вкладки: её положила главная страница перед уходом в мессенджер. Если
  // страницу открыли напрямую, метки нет — запросим свою вместе со ссылкой на бота.
  // Метка берётся из адреса (?t=, её кладёт кнопка «Вернуться на сайт» в MAX)
  // или из памяти браузера, общей для всех вкладок сайта.
  const [loginToken, setLoginToken] = useState<string | null>(() => getMaxLoginToken());
  const [autoCode, setAutoCode] = useState(false);
  // Бот ждёт номер: человек в системе ещё не зарегистрирован.
  const [awaitingContact, setAwaitingContact] = useState(false);

  /** Новая метка и ссылка на бота: при первом открытии без метки, а также
   * когда старая протухла или её код не подошёл — иначе кнопка «Открыть чат
   * с ботом» вела бы по отработанной метке, и код снова не подставился бы. */
  const refreshToken = (replace: boolean) => {
    fetchMaxBotUrl()
      .then(({ botUrl: url, loginToken: fresh }) => {
        setBotUrl(url);
        if (fresh && (replace || !getMaxLoginToken())) {
          setMaxLoginToken(fresh);
          setLoginToken(fresh);
        }
      })
      .catch(() => {
        // FRONTEND-ONLY: не прячем уже полученную ссылку на бота.
      });
  };

  useEffect(() => {
    const t = getMaxLoginToken();
    // Пришли по адресу возврата из MAX — запоминаем метку для остальных вкладок
    // и убираем её из адресной строки.
    if (t) {
      setMaxLoginToken(t);
      if (window.location.search.includes('t=')) {
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
    refreshToken(false);
    // Ссылку тянем один раз: новая метка при каждом рендере обесценивала бы старую.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * АВТОПОДСТАНОВКА КОДА.
   *
   * Пока человек в мессенджере, вкладка раз в 2 секунды спрашивает сервер, не выдал ли
   * бот код по её метке. Как только код появился — подставляем его в поле и сразу
   * входим. Переписывать шесть цифр руками больше не нужно: достаточно вернуться
   * на эту вкладку.
   *
   * Ручной ввод оставлен рабочим: человек мог открыть сайт на компьютере, а бота — на
   * телефоне, и тогда вкладка с меткой ничего не дождётся.
   */
  useEffect(() => {
    if (!loginToken || pendingUser || verifying) return;
    let stop = false;

    let busy = false;

    // Вход уже сделала другая вкладка сайта (общая память браузера) — просто
    // переходим в систему, а не пытаемся ещё раз войти тем же одноразовым кодом.
    const enteredElsewhere = () => {
      try {
        return !!localStorage.getItem('megatul_user');
      } catch {
        return false;
      }
    };

    const tick = async () => {
      if (stop || busy) return;
      if (enteredElsewhere()) {
        window.location.replace('/crm');
        return;
      }
      busy = true;
      try {
        const status = await fetchMaxLoginStatus(loginToken);
        if (stop) return;
        if (status.expired) {
          // Метка протухла (больше 15 минут) — заводим новую молча.
          clearMaxLoginToken();
          setLoginToken(null);
          refreshToken(true);
          return;
        }
        setAwaitingContact(status.awaitingContact);
        if (!status.code) return;
        setCode(status.code);
        setAutoCode(true);
        const tokenUsed = loginToken;
        clearMaxLoginToken();
        // Опрос по этой метке закончен: при ошибке не долбим сервер одним и тем
        // же отработанным кодом каждые 2 секунды.
        stop = true;
        setLoginToken(null);
        setVerifying(true);
        try {
          // С меткой сервер пускает этим кодом любую вкладку этого браузера:
          // какую бы человек ни открыл, вход пройдёт в ней.
          await applyAuthResult(await verifyMaxCode(status.code, tokenUsed));
        } catch (err) {
          if (enteredElsewhere()) {
            window.location.replace('/crm');
            return;
          }
          setError(
            (err instanceof Error ? err.message : 'Не удалось подтвердить код') +
              '. Откройте чат с ботом ещё раз — придёт новый код.',
          );
          setAutoCode(false);
          setCode('');
          refreshToken(true);
        } finally {
          setVerifying(false);
        }
      } catch {
        // Молчим: сеть могла моргнуть, следующая попытка через пару секунд.
      } finally {
        busy = false;
      }
    };

    // Вернулись из мессенджера — проверяем сразу, не дожидаясь таймера: пока
    // вкладка была скрыта, браузер мог притормозить опрос.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const timer = setInterval(tick, 2000);
    void tick();
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginToken, pendingUser, verifying]);

  const finishLogin = (data: {
    id: number;
    name: string;
    role: string;
    workshopId: number | null;
    workshopName: string | null;
    shiftNumber: number | null;
    /** Ключ сессии — по нему сервер проверяет права на каждом действии. */
    token?: string;
  }) => {
    login(
      {
        id: data.id,
        name: data.name,
        role: data.role as Role,
        availableRoles: pendingUser
          ? pendingUser.roles.filter((r) => r.isApproved).map((r) => r.role)
          : [data.role as Role],
        workshopId: data.workshopId ?? null,
        workshopName: data.workshopName ?? null,
        shiftNumber: data.shiftNumber ?? null,
      },
      data.token,
    );
    navigate('/crm');
  };

  const applyAuthResult = async (result: {
    id: number;
    name: string;
    phone: string | null;
    roles: UserRoleEntry[];
  }) => {
    const approvedRoles = result.roles.filter((r) => r.isApproved);
    const authUser = { id: result.id, name: result.name, phone: result.phone, roles: result.roles };

    if (approvedRoles.length === 0) {
      setPendingUser(authUser);
      return;
    }
    if (approvedRoles.length === 1) {
      const data = await enterRole(result.id, approvedRoles[0].role);
      finishLogin(data);
      return;
    }
    setPendingUser(authUser);
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setVerifying(true);
    try {
      await applyAuthResult(await verifyMaxCode(code.trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось подтвердить код');
    } finally {
      setVerifying(false);
    }
  };

  const handlePickActiveRole = async (role: Role) => {
    if (!pendingUser) return;
    setEntering(true);
    setError('');
    try {
      const data = await enterRole(pendingUser.id, role);
      finishLogin(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
    } finally {
      setEntering(false);
    }
  };

  const approvedRoles = pendingUser?.roles.filter((r) => r.isApproved) ?? [];
  const showPending = pendingUser && approvedRoles.length === 0;
  const showRolePick = pendingUser && approvedRoles.length > 1;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-6 py-12 sm:py-16">
      <LoginBackground />
      
      <div className="relative w-full max-w-[360px] animate-fade-in">
        <div className="mb-10 mt-2 flex flex-col items-center gap-4 text-center">
          <img
            src="/assets/megatul-round-logo.png"
            alt="МЕГАТЮЛЬ"
            className="h-24 w-24 object-contain rounded-md"
          />
        </div>

        {showPending && (
          <PendingApprovalScreen
            roles={pendingUser.roles.map((r) => r.role)}
            onLogout={() => navigate('/')}
          />
        )}

        {showRolePick && (
          <>
            <RoleSelectScreen
              title={`Здравствуйте, ${pendingUser.name}!`}
              description="Выберите, в какой должности хотите работать сейчас"
              roles={approvedRoles.map((r) => r.role)}
              disabled={entering}
              onSelect={handlePickActiveRole}
            />
            {error && <p className="login-plate mt-3 text-center text-sm text-destructive">{error}</p>}
          </>
        )}

        {!pendingUser && (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            {autoCode ? (
              <p className="login-plate flex items-center justify-center gap-2 text-center text-sm text-emerald-600">
                <Icon name="Check" size={15} />
                Код получен, входим…
              </p>
            ) : (
              <p className="login-plate text-center text-sm font-medium text-muted-foreground">
                {awaitingContact
                  ? 'Нажмите в чате кнопку «Поделиться номером» — и возвращайтесь сюда, код подставится сам.'
                  : 'Ожидаем код из чата с ботом — он подставится сам. Или введите его вручную.'}
              </p>
            )}

            <Input
              type="text"
              inputMode="numeric"
              placeholder="Код из MAX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="h-11 rounded-sm border-border bg-white shadow-md text-center font-mono-tech text-lg tracking-[0.3em]"
              maxLength={6}
              required
              autoFocus
              disabled={autoCode}
            />

            {error && <p className="login-plate text-center text-sm text-destructive">{error}</p>}

            <Button
              type="submit"
              disabled={verifying}
              className="h-11 w-full rounded-sm bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {verifying ? (
                <Icon name="Loader2" size={18} className="animate-spin" />
              ) : (
                'Подтвердить и войти'
              )}
            </Button>

            {/* Кнопка возврата в чат: код потерялся или бот не прислал сообщение —
                человек открывает бота снова, не теряя эту страницу. */}
            {botUrl && (
              <a
                href={botUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-11 w-full items-center justify-center gap-2 rounded-sm border border-border bg-white shadow-md text-sm hover:bg-muted"
              >
                <Icon name="MessageCircle" size={16} />
                Открыть чат с ботом
              </a>
            )}

            <button
              type="button"
              onClick={() => navigate('/')}
              className="login-plate w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Назад
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginCode;