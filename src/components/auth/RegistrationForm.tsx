import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { roleLabels, type Role } from '@/lib/roles';
import type { RegistrationForm as RegistrationFormData } from '@/lib/authApi';

const roleIcons: Record<Role, string> = {
  admin: 'ShieldCheck',
  storekeeper: 'Warehouse',
  sewer: 'Shirt',
  cutter: 'Scissors',
  packer: 'PackageCheck',
  cleaner: 'Sparkles',
  manager: 'Briefcase',
};

/** Держит номер в виде +7 (XXX) XXX-XX-XX. Префикс +7 стоит всегда и не стирается:
 * сотрудник вводит только свои 10 цифр, поэтому номер не получится сохранить в чужом
 * формате (8..., без кода страны) и он всегда попадёт в базу одинаковым. */
export const formatPhone = (raw: string): string => {
  let digits = raw.replace(/\D/g, '');
  // Ведущие 7 или 8 — это код страны, который у нас уже нарисован префиксом.
  if (digits.startsWith('7') || digits.startsWith('8')) digits = digits.slice(1);
  digits = digits.slice(0, 10);

  let out = '+7';
  if (digits.length > 0) out += ` (${digits.slice(0, 3)}`;
  if (digits.length >= 3) out += `) ${digits.slice(3, 6)}`;
  if (digits.length >= 6) out += `-${digits.slice(6, 8)}`;
  if (digits.length >= 8) out += `-${digits.slice(8, 10)}`;
  return out;
};

/** Сколько цифр номера ввёл сотрудник (без кода страны) — нужно для проверки полноты. */
const phoneDigits = (formatted: string): string => formatted.replace(/\D/g, '').replace(/^7/, '');

interface RegistrationFormProps {
  roles: Role[];
  submitting: boolean;
  error?: string;
  onSubmit: (form: RegistrationFormData) => void;
  onBack: () => void;
}

/** Заявка нового сотрудника: ФИО, должность, почта для восстановления доступа и телефон.
 * Заполняет человек, которого ещё нет в системе — заявка уходит администратору, тот
 * утверждает её и выдаёт логин с паролем. */
const RegistrationForm = ({ roles, submitting, error, onSubmit, onBack }: RegistrationFormProps) => {
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+7');
  const [touched, setTouched] = useState(false);

  const nameValid = fullName.trim().length >= 3;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const phoneValid = phoneDigits(phone).length === 10;
  const valid = nameValid && emailValid && phoneValid && !!role;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid || !role) return;
    onSubmit({ fullName: fullName.trim(), role, email: email.trim(), phone });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="text-center">
        <h2 className="text-base font-semibold">Заявка на доступ</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Администратор проверит заявку и выдаст вам логин с паролем
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Фамилия, имя и отчество</label>
        <Input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Иванова Мария Петровна"
          className="h-11 rounded-sm border-border bg-transparent"
          autoFocus
        />
        {touched && !nameValid && (
          <p className="text-xs text-destructive">Введите фамилию, имя и отчество</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Должность</label>
        <div className="grid grid-cols-2 gap-2">
          {roles.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              className={`flex flex-col items-center gap-1.5 rounded-sm border px-3 py-3 text-center transition-colors ${
                role === r
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-transparent hover:border-primary hover:bg-primary/5'
              }`}
            >
              <Icon
                name={roleIcons[r] || 'User'}
                size={20}
                className={role === r ? 'text-primary' : 'text-muted-foreground'}
              />
              <span className="text-xs font-medium leading-tight">{roleLabels[r]}</span>
            </button>
          ))}
        </div>
        {touched && !role && <p className="text-xs text-destructive">Выберите должность</p>}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">
          Почта для восстановления доступа
        </label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="mariya@example.ru"
          className="h-11 rounded-sm border-border bg-transparent"
        />
        {touched && !emailValid && (
          <p className="text-xs text-destructive">Введите корректный адрес почты</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Номер телефона</label>
        <Input
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(formatPhone(e.target.value))}
          onFocus={() => !phone && setPhone('+7')}
          placeholder="+7 (900) 000-00-00"
          className="h-11 rounded-sm border-border bg-transparent font-mono-tech"
        />
        {touched && !phoneValid && (
          <p className="text-xs text-destructive">Введите 10 цифр номера</p>
        )}
      </div>

      {error && <p className="text-center text-sm text-destructive">{error}</p>}

      <Button
        type="submit"
        disabled={submitting}
        className="h-11 w-full rounded-sm bg-primary text-primary-foreground hover:bg-primary/90"
      >
        {submitting ? (
          <Icon name="Loader2" size={18} className="animate-spin" />
        ) : (
          'Отправить заявку'
        )}
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

export default RegistrationForm;
