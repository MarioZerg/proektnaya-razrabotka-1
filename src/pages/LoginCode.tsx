import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/lib/roles';
import {
  fetchMaxBotUrl,
  verifyMaxCode,
  enterRole,
  type UserRoleEntry,
} from '@/lib/authApi';
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

  useEffect(() => {
    fetchMaxBotUrl().then(setBotUrl);
  }, []);

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
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-[0.25]" />

      <div className="relative w-full max-w-[360px] animate-fade-in">
        <div className="mb-10 mt-2 flex flex-col items-center gap-4 text-center">
          <img
            src="/assets/megatul-round-logo.png"
            alt="МЕГАТЮЛЬ"
            className="h-24 w-24 object-contain"
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
            {error && <p className="mt-3 text-center text-sm text-destructive">{error}</p>}
          </>
        )}

        {!pendingUser && (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            <p className="text-center text-sm text-muted-foreground">
              Поделитесь номером телефона в чате с ботом — код придёт сообщением. Затем
              вернитесь сюда и введите его.
            </p>

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
                className="flex h-11 w-full items-center justify-center gap-2 rounded-sm border border-border text-sm hover:bg-muted"
              >
                <Icon name="MessageCircle" size={16} />
                Открыть чат с ботом
              </a>
            )}

            <button
              type="button"
              onClick={() => navigate('/')}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
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
