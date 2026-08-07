import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/lib/roles';
import {
  fetchMaxBotUrl,
  verifyMaxCode,
  submitRegistration,
  passwordLogin,
  enterRole,
  type UserRoleEntry,
  type RegistrationForm as RegistrationFormData,
} from '@/lib/authApi';
import OnlineNowBadge from '@/components/auth/OnlineNowBadge';
import RoleSelectScreen from '@/components/auth/RoleSelectScreen';
import RegistrationForm from '@/components/auth/RegistrationForm';
import PasswordLoginForm from '@/components/auth/PasswordLoginForm';
import PendingApprovalScreen from '@/components/auth/PendingApprovalScreen';
import { roleOptions } from '@/components/crm/users/usersShared';

type Step =
  | 'start'
  | 'code'
  | 'register'
  | 'registerDone'
  | 'passwordLogin'
  | 'pendingApproval'
  | 'pickActiveRole';

const Index = () => {
  const navigate = useNavigate();
  const { login, user } = useAuth();

  const [step, setStep] = useState<Step>('start');
  const [botUrl, setBotUrl] = useState<string | null>(null);
  const [botOpened, setBotOpened] = useState(false);

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  const [pendingUser, setPendingUser] = useState<{
    id: number;
    name: string;
    phone: string | null;
    roles: UserRoleEntry[];
  } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [entering, setEntering] = useState(false);

  // Уже вошедшего сотрудника сразу уводим в систему.
  //
  // Зачем: на несуществующий адрес (404) человек попадает вместе с открытой сессией,
  // а экран 404 через 3 секунды уводит на главную. Главная — это страница входа, и
  // раньше она показывала форму «Войти через MAX», будто сессии нет: выглядело как
  // разлогин, приходилось заходить заново. Сессия при этом никуда не пропадала —
  // её просто не проверяли.
  useEffect(() => {
    if (user) navigate('/crm', { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    fetchMaxBotUrl().then(setBotUrl);
  }, []);

  const handleOpenBot = () => {
    if (botUrl) {
      window.open(botUrl, '_blank', 'noopener,noreferrer');
    }
    setBotOpened(true);
    setStep('code');
  };

  const finishLogin = (data: {
    id: number;
    name: string;
    role: string;
    workshopId: number | null;
    workshopName: string | null;
    shiftNumber: number | null;
  }) => {
    login({
      id: data.id,
      name: data.name,
      role: data.role as Role,
      availableRoles: pendingUser
        ? pendingUser.roles.filter((r) => r.isApproved).map((r) => r.role)
        : [data.role as Role],
      workshopId: data.workshopId ?? null,
      workshopName: data.workshopName ?? null,
      shiftNumber: data.shiftNumber ?? null,
    });
    navigate('/crm');
  };

  // Вход через MAX и вход по паролю возвращают одно и то же — пользователя со списком
  // должностей, поэтому дальше оба идут по общему пути.
  const applyAuthResult = async (result: {
    id: number;
    name: string;
    phone: string | null;
    roles: UserRoleEntry[];
  }) => {
    const approvedRoles = result.roles.filter((r) => r.isApproved);
    const user = { id: result.id, name: result.name, phone: result.phone, roles: result.roles };

    if (approvedRoles.length === 0) {
      setPendingUser(user);
      setStep('pendingApproval');
      return;
    }

    if (approvedRoles.length === 1) {
      const data = await enterRole(result.id, approvedRoles[0].role);
      finishLogin(data);
      return;
    }

    setPendingUser(user);
    setStep('pickActiveRole');
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

  const handlePasswordLogin = async (userLogin: string, password: string) => {
    setError('');
    setVerifying(true);
    try {
      await applyAuthResult(await passwordLogin(userLogin, password));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти');
    } finally {
      setVerifying(false);
    }
  };

  const handleSubmitRegistration = async (form: RegistrationFormData) => {
    setSelecting(true);
    setError('');
    try {
      await submitRegistration(form);
      setStep('registerDone');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить заявку');
    } finally {
      setSelecting(false);
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

  const handleBackToStart = () => {
    setStep('start');
    setCode('');
    setError('');
    setPendingUser(null);
    setBotOpened(false);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-6">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-[0.25]" />

      <div className="relative w-full max-w-[360px] animate-fade-in">
        <div className="mb-10 flex flex-col items-center gap-4 text-center">
          {/* Логотип с названием плавно наезжает при открытии страницы. */}
          <img
            src="/assets/megatul-logo.png"
            alt="МЕГАТЮЛЬ"
            className="h-28 w-auto animate-logo-zoom"
          />
          <OnlineNowBadge />
        </div>

        {step === 'start' && (
          <div className="space-y-4">
            <Button
              type="button"
              onClick={handleOpenBot}
              disabled={!botUrl}
              className="relative h-12 w-full overflow-hidden rounded-sm bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {/* Блик пробегает по кнопке — подсказывает, что это основной способ входа. */}
              <span className="pointer-events-none absolute inset-0 -skew-x-12 animate-shimmer bg-gradient-to-r from-transparent via-white/30 to-transparent" />
              <Icon name="MessageCircle" size={18} className="mr-2" />
              Войти через MAX
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Откроется бот МЕГАТЮЛЬ — поделитесь номером телефона, и бот пришлёт код для входа
            </p>

            <div className="flex items-center gap-3 pt-2">
              <div className="h-px flex-1 bg-border" />
              <p className="font-mono-tech text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                или
              </p>
              <div className="h-px flex-1 bg-border" />
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError('');
                setStep('register');
              }}
              className="h-12 w-full rounded-sm"
            >
              <Icon name="UserPlus" size={18} className="mr-2" />
              Подать заявку на доступ
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError('');
                setStep('passwordLogin');
              }}
              className="h-12 w-full rounded-sm"
            >
              <Icon name="KeyRound" size={18} className="mr-2" />
              Вход по паролю
            </Button>

            {/* Реквизиты компании и юридические документы. */}
            <div className="space-y-0.5 pt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
              <p className="pb-1">
                <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
                  Политика конфиденциальности
                </Link>
                {' · '}
                <Link to="/consent" className="underline underline-offset-2 hover:text-foreground">
                  Обработка персональных данных
                </Link>
              </p>
              <p>Система управления швейного производства</p>
              <p>ИНН: 760218194200 · ОГРН: 322774600341432</p>
              <p>
                ИП Левкин А.С. ·{' '}
                <a href="tel:+79997863525" className="hover:text-foreground">
                  +7 999 786-35-25
                </a>
              </p>
            </div>

          </div>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            {botOpened && (
              <p className="text-center text-sm text-muted-foreground">
                Бот открылся в новой вкладке. Поделитесь номером телефона в чате — код придёт сообщением.
              </p>
            )}
            <Input
              type="text"
              inputMode="numeric"
              placeholder="Код из MAX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="h-11 rounded-sm border-border bg-transparent text-center font-mono-tech text-lg tracking-[0.3em]"
              maxLength={6}
              required
              autoFocus
            />

            {error && <p className="text-center text-sm text-destructive">{error}</p>}

            <Button
              type="submit"
              disabled={verifying}
              className="h-11 w-full rounded-sm bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {verifying ? <Icon name="Loader2" size={18} className="animate-spin" /> : 'Подтвердить и войти'}
            </Button>

            <button
              type="button"
              onClick={handleBackToStart}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
            >
              Назад
            </button>
          </form>
        )}

        {step === 'register' && (
          <RegistrationForm
            roles={roleOptions.filter((r) => r !== 'admin')}
            submitting={selecting}
            error={error}
            onSubmit={handleSubmitRegistration}
            onBack={handleBackToStart}
          />
        )}

        {step === 'registerDone' && (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/10 text-emerald-600">
              <Icon name="MailCheck" size={28} />
            </div>
            <div>
              <h2 className="text-base font-semibold">Заявка отправлена</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Администратор проверит её и выдаст вам логин с паролем. После этого
                возвращайтесь и заходите через «Вход по паролю».
              </p>
            </div>
            <Button variant="outline" className="h-11 w-full rounded-sm" onClick={handleBackToStart}>
              На главную
            </Button>
          </div>
        )}

        {step === 'passwordLogin' && (
          <PasswordLoginForm
            submitting={verifying}
            error={error}
            onSubmit={handlePasswordLogin}
            onBack={handleBackToStart}
          />
        )}

        {step === 'pendingApproval' && pendingUser && (
          <PendingApprovalScreen roles={pendingUser.roles.map((r) => r.role)} onLogout={handleBackToStart} />
        )}

        {step === 'pickActiveRole' && pendingUser && (
          <>
            <RoleSelectScreen
              title={`Здравствуйте, ${pendingUser.name}!`}
              description="Выберите, в какой должности хотите работать сейчас"
              roles={pendingUser.roles.filter((r) => r.isApproved).map((r) => r.role)}
              disabled={entering}
              onSelect={handlePickActiveRole}
            />
            {error && <p className="mt-3 text-center text-sm text-destructive">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
};

export default Index;