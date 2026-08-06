import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/lib/roles';
import {
  fetchBotUrls,
  verifyMessengerCode,
  selectDesiredRole,
  enterRole,
  type UserRoleEntry,
  type BotUrls,
  type Messenger,
} from '@/lib/authApi';
import type { TestAccount } from '@/lib/authApi';
import TestAccountsPanel from '@/components/auth/TestAccountsPanel';
import RoleSelectScreen from '@/components/auth/RoleSelectScreen';
import PendingApprovalScreen from '@/components/auth/PendingApprovalScreen';
import { roleOptions } from '@/components/crm/users/usersShared';

type Step = 'start' | 'code' | 'pickDesiredRole' | 'pendingApproval' | 'pickActiveRole';

const Index = () => {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [step, setStep] = useState<Step>('start');
  const [botUrls, setBotUrls] = useState<BotUrls>({ max: null, telegram: null });
  const [botOpened, setBotOpened] = useState(false);
  // Через какой мессенджер сотрудник вошёл — от этого зависит, в какой таблице
  // сессий backend будет искать введённый код.
  const [messenger, setMessenger] = useState<Messenger>('max');

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  const [pendingUser, setPendingUser] = useState<{ id: number; name: string; roles: UserRoleEntry[] } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    fetchBotUrls().then(setBotUrls);
  }, []);

  const handleOpenBot = (target: Messenger) => {
    const url = target === 'telegram' ? botUrls.telegram : botUrls.max;
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    setMessenger(target);
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

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setVerifying(true);
    try {
      const result = await verifyMessengerCode(code.trim(), messenger);
      const approvedRoles = result.roles.filter((r) => r.isApproved);

      if (result.roles.length === 0) {
        setPendingUser({ id: result.id, name: result.name, roles: result.roles });
        setStep('pickDesiredRole');
        return;
      }

      if (approvedRoles.length === 0) {
        setPendingUser({ id: result.id, name: result.name, roles: result.roles });
        setStep('pendingApproval');
        return;
      }

      if (approvedRoles.length === 1) {
        const data = await enterRole(result.id, approvedRoles[0].role);
        finishLogin(data);
        return;
      }

      setPendingUser({ id: result.id, name: result.name, roles: result.roles });
      setStep('pickActiveRole');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось подтвердить код');
    } finally {
      setVerifying(false);
    }
  };

  const handleSelectDesiredRole = async (role: Role) => {
    if (!pendingUser) return;
    setSelecting(true);
    setError('');
    try {
      await selectDesiredRole(pendingUser.id, role);
      setPendingUser({ ...pendingUser, roles: [{ role, isApproved: false }] });
      setStep('pendingApproval');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выбрать должность');
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

  const handleTestAccountSelect = (account: TestAccount) => {
    login({ ...account, availableRoles: [account.role], isDemo: true });
    navigate('/crm');
  };

  const handleBackToStart = () => {
    setStep('start');
    setCode('');
    setError('');
    setPendingUser(null);
    setBotOpened(false);
    setMessenger('max');
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-6">
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-[0.25]" />

      <div className="relative w-full max-w-[360px] animate-fade-in">
        <div className="mb-10 flex flex-col items-center gap-4 text-center">
          <img src="/assets/megatul-logo.png" alt="МЕГАТЮЛЬ" className="h-14 w-auto" />
          <p className="font-mono-tech text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
            ERP · швейное производство
          </p>
        </div>

        {step === 'start' && (
          <div className="space-y-4">
            <Button
              type="button"
              onClick={() => handleOpenBot('max')}
              disabled={!botUrls.max}
              className="h-12 w-full rounded-sm bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Icon name="MessageCircle" size={18} className="mr-2" />
              Войти через MAX
            </Button>
            <Button
              type="button"
              onClick={() => handleOpenBot('telegram')}
              disabled={!botUrls.telegram}
              className="h-12 w-full rounded-sm bg-[#229ED9] text-white hover:bg-[#1c8ac0]"
            >
              <Icon name="Send" size={18} className="mr-2" />
              Войти через Telegram
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Откроется бот МЕГАТЮЛЬ — поделитесь номером телефона, и бот пришлёт код для входа
            </p>

            <div className="mt-8 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <p className="font-mono-tech text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Демо-вход без пароля
                </p>
                <div className="h-px flex-1 bg-border" />
              </div>
              <TestAccountsPanel onSelect={handleTestAccountSelect} />
            </div>
          </div>
        )}

        {step === 'code' && (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            {botOpened && (
              <p className="text-center text-sm text-muted-foreground">
                Бот {messenger === 'telegram' ? 'Telegram' : 'MAX'} открылся в новой вкладке.
                Поделитесь номером телефона в чате — код придёт сообщением.
              </p>
            )}
            <Input
              type="text"
              inputMode="numeric"
              placeholder={messenger === 'telegram' ? 'Код из Telegram' : 'Код из MAX'}
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

        {step === 'pickDesiredRole' && (
          <>
            <RoleSelectScreen
              title="Кем вы будете работать?"
              description="Выберите должность — администратор проверит и утвердит её"
              roles={roleOptions.filter((r) => r !== 'admin')}
              disabled={selecting}
              onSelect={handleSelectDesiredRole}
            />
            {error && <p className="mt-3 text-center text-sm text-destructive">{error}</p>}
          </>
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