import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';

const Index = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      login({ name: 'Администратор', role: 'admin' });
      navigate('/crm');
    }, 600);
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
            type="email"
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

          <Button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-sm bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {loading ? <Icon name="Loader2" size={18} className="animate-spin" /> : 'Войти'}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default Index;
