import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/lib/roles';
import { AUTH_URL, sendMaxLoginCode, verifyMaxLoginCode } from '@/lib/authApi';
import type { TestAccount } from '@/lib/authApi';
import TestAccountsPanel from '@/components/auth/TestAccountsPanel';

type LoginMode = 'password' | 'max';

const Index = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [mode, setMode] = useState<LoginMode>('password');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [maxLogin, setMaxLogin] = useState('');
  const [maxCode, setMaxCode] = useState('');
  const [maxCodeSent, setMaxCodeSent] = useState(false);
  const [maxSending, setMaxSending] = useState(false);
  const [maxVerifying, setMaxVerifying] = useState(false);
  const [maxError, setMaxError] = useState('');

  const applyUser = (data: {
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
      workshopId: data.workshopId ?? null,
      workshopName: data.workshopName ?? null,
      shiftNumber: data.shiftNumber ?? null,
    });
    navigate('/crm');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Не удалось войти');
        return;
      }
      applyUser(data);
    } catch {
      setError('Не удалось связаться с сервером');
    } finally {
      setLoading(false);
    }
  };

  const handleTestAccountSelect = (account: TestAccount) => {
    login({ ...account, isDemo: true });
    navigate('/crm');
  };

  const handleSendMaxCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setMaxError('');
    setMaxSending(true);
    try {
      await sendMaxLoginCode(maxLogin.trim());
      setMaxCodeSent(true);
    } catch (err) {
      setMaxError(err instanceof Error ? err.message : 'Не удалось отправить код');
    } finally {
      setMaxSending(false);
    }
  };

  const handleVerifyMaxCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setMaxError('');
    setMaxVerifying(true);
    try {
      const data = await verifyMaxLoginCode(maxLogin.trim(), maxCode.trim());
      applyUser(data);
    } catch (err) {
      setMaxError(err instanceof Error ? err.message : 'Не удалось подтвердить код');
    } finally {
      setMaxVerifying(false);
    }
  };

  const switchMode = (next: LoginMode) => {
    setMode(next);
    setError('');
    setMaxError('');
    setMaxCodeSent(false);
    setMaxCode('');
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

        <div className="mb-4 grid grid-cols-2 gap-1 rounded-sm border border-border p-1">
          <button
            type="button"
            onClick={() => switchMode('password')}
            className={`rounded-sm py-1.5 text-sm font-medium transition-colors ${
              mode === 'password' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Логин и пароль
          </button>
          <button
            type="button"
            onClick={() => switchMode('max')}
            className={`flex items-center justify-center gap-1.5 rounded-sm py-1.5 text-sm font-medium transition-colors ${
              mode === 'max' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon name="MessageCircle" size={14} />
            Через MAX
          </button>
        </div>

        {mode === 'password' ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="text"
              placeholder="Логин"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-sm border-border bg-transparent"
              required
            />

            <div className="relative">
              <Input
                type={showPass ? 'text' : 'password'}
                placeholder="Пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 rounded-sm border-border bg-transparent pr-10"
                required
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Показать пароль"
              >
                <Icon name={showPass ? 'EyeOff' : 'Eye'} size={16} />
              </button>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-sm bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {loading ? <Icon name="Loader2" size={18} className="animate-spin" /> : 'Войти'}
            </Button>
          </form>
        ) : (
          <div className="space-y-3">
            {!maxCodeSent ? (
              <form onSubmit={handleSendMaxCode} className="space-y-3">
                <Input
                  type="text"
                  placeholder="Логин"
                  value={maxLogin}
                  onChange={(e) => setMaxLogin(e.target.value)}
                  className="h-11 rounded-sm border-border bg-transparent"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Код для входа придёт личным сообщением от бота МЕГАТЮЛЬ в мессенджере MAX.
                  MAX должен быть привязан администратором в вашей карточке сотрудника.
                </p>

                {maxError && <p className="text-sm text-destructive">{maxError}</p>}

                <Button
                  type="submit"
                  disabled={maxSending}
                  className="h-11 w-full rounded-sm bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {maxSending ? <Icon name="Loader2" size={18} className="animate-spin" /> : 'Отправить код в MAX'}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleVerifyMaxCode} className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Код отправлен в MAX сотруднику с логином <span className="font-medium text-foreground">{maxLogin}</span>
                </p>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="Код из MAX"
                  value={maxCode}
                  onChange={(e) => setMaxCode(e.target.value)}
                  className="h-11 rounded-sm border-border bg-transparent text-center font-mono-tech text-lg tracking-[0.3em]"
                  maxLength={6}
                  required
                  autoFocus
                />

                {maxError && <p className="text-sm text-destructive">{maxError}</p>}

                <Button
                  type="submit"
                  disabled={maxVerifying}
                  className="h-11 w-full rounded-sm bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {maxVerifying ? <Icon name="Loader2" size={18} className="animate-spin" /> : 'Подтвердить и войти'}
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setMaxCodeSent(false);
                    setMaxCode('');
                    setMaxError('');
                  }}
                  className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                >
                  Отправить код ещё раз
                </button>
              </form>
            )}
          </div>
        )}

        <div className="mt-8 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <p className="font-mono-tech text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Демо-вход без пароля
            </p>
            <div className="h-px flex-1 bg-border" />
          </div>
          <TestAccountsPanel onSelect={handleTestAccountSelect} disabled={loading} />
        </div>
      </div>
    </div>
  );
};

export default Index;
