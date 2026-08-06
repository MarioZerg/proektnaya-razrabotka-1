import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';

interface PasswordLoginFormProps {
  submitting: boolean;
  error?: string;
  onSubmit: (login: string, password: string) => void;
  onBack: () => void;
}

/** Вход по логину и паролю — запасной путь, когда MAX недоступен. Логин и пароль
 * сотруднику выдаёт администратор, когда утверждает его заявку. */
const PasswordLoginForm = ({ submitting, error, onSubmit, onBack }: PasswordLoginFormProps) => {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !password) return;
    onSubmit(login.trim(), password);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="text-center">
        <h2 className="text-base font-semibold">Вход по паролю</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Логин и пароль выдаёт администратор
        </p>
      </div>

      <Input
        value={login}
        onChange={(e) => setLogin(e.target.value)}
        placeholder="Логин"
        className="h-11 rounded-sm border-border bg-transparent"
        autoFocus
        autoComplete="username"
      />

      <div className="relative">
        <Input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль"
          className="h-11 rounded-sm border-border bg-transparent pr-11"
          autoComplete="current-password"
        />
        <button
          type="button"
          onClick={() => setShowPassword((v) => !v)}
          className="absolute right-0 top-0 grid h-11 w-11 place-items-center text-muted-foreground hover:text-foreground"
          aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
        >
          <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={18} />
        </button>
      </div>

      {error && <p className="text-center text-sm text-destructive">{error}</p>}

      <Button
        type="submit"
        disabled={submitting}
        className="h-11 w-full rounded-sm bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {submitting ? <Icon name="Loader2" size={18} className="animate-spin" /> : 'Войти'}
      </Button>

      <button
        type="button"
        onClick={onBack}
        className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
      >
        Назад
      </button>
    </form>
  );
};

export default PasswordLoginForm;
