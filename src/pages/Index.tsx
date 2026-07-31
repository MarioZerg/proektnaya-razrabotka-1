import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';

type Mode = 'login' | 'register';

const Index = () => {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const validate = () => {
    const next: Record<string, string> = {};
    if (mode === 'register' && name.trim().length < 2) {
      next.name = 'Введите имя';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      next.email = 'Некорректный email';
    }
    if (password.length < 6) {
      next.password = 'Минимум 6 символов';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      toast({
        title: mode === 'login' ? 'Вы вошли в кабинет' : 'Аккаунт создан',
        description:
          mode === 'login'
            ? 'Добро пожаловать в «Ориентир».'
            : 'Мы отправили ссылку для подтверждения на ваш email.',
      });
      setPassword('');
    }, 900);
  };

  const switchMode = () => {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setErrors({});
  };

  return (
    <div className="relative min-h-screen bg-primary text-primary-foreground">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 grid-bg opacity-[0.35]" />
      <div className="pointer-events-none absolute -left-40 top-1/4 h-96 w-96 rounded-full bg-accent/25 blur-[120px]" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-80 w-80 rounded-full bg-accent/15 blur-[120px]" />

      <div className="relative mx-auto grid min-h-screen max-w-6xl grid-cols-1 lg:grid-cols-2">
        {/* Left — brand story */}
        <div className="hidden flex-col justify-between p-12 lg:flex">
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-foreground">
              <Icon name="Compass" size={22} />
            </span>
            <span className="text-lg font-extrabold tracking-tight">Ориентир</span>
          </div>

          <div className="max-w-md animate-fade-in">
            <p className="font-mono-tech text-xs uppercase tracking-[0.3em] text-accent">
              ERP-система
            </p>
            <h1 className="mt-4 text-4xl font-extrabold leading-tight text-balance">
              Весь бизнес — в едином окне
            </h1>
            <p className="mt-4 text-primary-foreground/70">
              Склад, финансы, продажи, производство и аналитика. Войдите, чтобы
              продолжить управление компанией.
            </p>

            <ul className="mt-8 space-y-3">
              {[
                { icon: 'ShieldCheck', text: 'Данные под защитой и шифрованием' },
                { icon: 'Zap', text: 'Мгновенная синхронизация отделов' },
                { icon: 'BarChart3', text: 'Отчёты и аналитика в реальном времени' },
              ].map((item) => (
                <li key={item.text} className="flex items-center gap-3 text-sm">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5 text-accent">
                    <Icon name={item.icon} size={16} />
                  </span>
                  <span className="text-primary-foreground/80">{item.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="font-mono-tech text-xs text-primary-foreground/40">
            © 2026 Ориентир. Все права защищены.
          </p>
        </div>

        {/* Right — auth card */}
        <div className="flex items-center justify-center p-6 sm:p-12">
          <div className="w-full max-w-sm animate-scale-in">
            {/* Mobile logo */}
            <div className="mb-8 flex items-center justify-center gap-2.5 lg:hidden">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-foreground">
                <Icon name="Compass" size={22} />
              </span>
              <span className="text-lg font-extrabold tracking-tight">Ориентир</span>
            </div>

            <div className="rounded-2xl bg-card p-8 text-card-foreground shadow-2xl">
              <h2 className="text-2xl font-extrabold text-primary">
                {mode === 'login' ? 'Вход в систему' : 'Создать аккаунт'}
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {mode === 'login'
                  ? 'Введите данные, чтобы попасть в кабинет'
                  : '14 дней бесплатно, без привязки карты'}
              </p>

              <form onSubmit={handleSubmit} className="mt-7 space-y-4">
                {mode === 'register' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Имя</Label>
                    <Input
                      id="name"
                      placeholder="Как вас зовут"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                    {errors.name && (
                      <p className="text-xs text-destructive">{errors.name}</p>
                    )}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="email">Рабочий email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@company.ru"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  {errors.email && (
                    <p className="text-xs text-destructive">{errors.email}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Пароль</Label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() =>
                          toast({
                            title: 'Восстановление пароля',
                            description:
                              'Введите email — мы пришлём ссылку для сброса.',
                          })
                        }
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        Забыли пароль?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPass ? 'text' : 'password'}
                      placeholder="Минимум 6 символов"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
                      aria-label="Показать пароль"
                    >
                      <Icon name={showPass ? 'EyeOff' : 'Eye'} size={16} />
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-xs text-destructive">{errors.password}</p>
                  )}
                </div>

                {mode === 'login' && (
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={remember}
                      onClick={() => setRemember((v) => !v)}
                      className={`grid h-5 w-5 place-items-center rounded-md border transition-colors ${
                        remember
                          ? 'border-accent bg-accent text-accent-foreground'
                          : 'border-input bg-transparent'
                      }`}
                    >
                      {remember && <Icon name="Check" size={13} />}
                    </button>
                    Запомнить меня
                  </label>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="h-11 w-full bg-accent font-semibold text-accent-foreground hover:bg-accent/90"
                >
                  {loading ? (
                    <Icon name="LoaderCircle" size={18} className="animate-spin" />
                  ) : mode === 'login' ? (
                    'Войти'
                  ) : (
                    'Зарегистрироваться'
                  )}
                </Button>
              </form>

              <div className="my-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">или</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <button
                type="button"
                onClick={() =>
                  toast({
                    title: 'Единый вход',
                    description: 'Корпоративный SSO скоро будет доступен.',
                  })
                }
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-input bg-background text-sm font-medium text-foreground transition-colors hover:bg-secondary"
              >
                <Icon name="KeyRound" size={16} />
                Войти через корпоративный SSO
              </button>

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {mode === 'login' ? 'Нет аккаунта? ' : 'Уже есть аккаунт? '}
                <button
                  type="button"
                  onClick={switchMode}
                  className="font-semibold text-accent hover:underline"
                >
                  {mode === 'login' ? 'Создать' : 'Войти'}
                </button>
              </p>
            </div>

            <p className="mt-6 text-center text-xs text-primary-foreground/40">
              Нажимая «Войти», вы принимаете условия использования и политику
              конфиденциальности.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
