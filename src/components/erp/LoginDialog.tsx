import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Mode = 'login' | 'register';

const LoginDialog = ({ open, onOpenChange }: LoginDialogProps) => {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
      onOpenChange(false);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        <div className="bg-primary px-8 pb-6 pt-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-accent text-accent-foreground">
            <Icon name="Compass" size={24} />
          </span>
          <h2 className="mt-4 text-xl font-extrabold text-primary-foreground">
            {mode === 'login' ? 'Вход в «Ориентир»' : 'Создать аккаунт'}
          </h2>
          <p className="mt-1 text-sm text-primary-foreground/70">
            {mode === 'login'
              ? 'Управляйте бизнесом из единого кабинета'
              : '14 дней бесплатно, без привязки карты'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-8 py-7">
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
            <Label htmlFor="password">Пароль</Label>
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

          <p className="text-center text-sm text-muted-foreground">
            {mode === 'login' ? 'Нет аккаунта? ' : 'Уже есть аккаунт? '}
            <button
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setErrors({});
              }}
              className="font-semibold text-accent hover:underline"
            >
              {mode === 'login' ? 'Создать' : 'Войти'}
            </button>
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default LoginDialog;
