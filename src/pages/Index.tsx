import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/lib/roles';
import { AUTH_URL } from '@/lib/authApi';
import type { TestAccount } from '@/lib/authApi';
import TestAccountsPanel from '@/components/auth/TestAccountsPanel';

const Index = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      login({
        id: data.id,
        name: data.name,
        role: data.role as Role,
        workshopId: data.workshopId ?? null,
        workshopName: data.workshopName ?? null,
        shiftNumber: data.shiftNumber ?? null,
      });
      navigate('/crm');
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