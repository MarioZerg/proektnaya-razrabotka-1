import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { roleLabels, type Role } from '@/lib/roles';
import type { Employee } from '@/lib/usersApi';

/** Выданный сотруднику доступ — показываем его админу один раз, после утверждения. */
export interface IssuedCredentials {
  fullName: string;
  login: string;
  password: string;
}

interface ApproveWithPasswordDialogProps {
  employee: Employee | null;
  role: Role | null;
  saving: boolean;
  /** Заполнено после успешного утверждения — вместо формы показываем логин и пароль. */
  issued: IssuedCredentials | null;
  onClose: () => void;
  onApprove: (password: string) => void;
}

/** Утверждение заявки: администратор задаёт сотруднику пароль и сразу получает логин
 * с паролем, чтобы продиктовать их лично. Пароль показывается только здесь и один раз —
 * в базе он хранится в зашифрованном виде и восстановить его нельзя. */
const ApproveWithPasswordDialog = ({
  employee,
  role,
  saving,
  issued,
  onClose,
  onApprove,
}: ApproveWithPasswordDialogProps) => {
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);

  const close = () => {
    setPassword('');
    setCopied(false);
    onClose();
  };

  const generate = () => {
    // Пароль из легко читаемых символов: его придётся диктовать вслух, поэтому
    // без похожих друг на друга 0/O и 1/l.
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 8; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
    setPassword(out);
  };

  const copyCredentials = () => {
    if (!issued) return;
    navigator.clipboard.writeText(`Логин: ${issued.login}\nПароль: ${issued.password}`);
    setCopied(true);
  };

  return (
    <Dialog open={!!employee} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-md">
        {issued ? (
          <>
            <DialogHeader>
              <DialogTitle>Доступ выдан</DialogTitle>
              <DialogDescription>
                Передайте эти данные сотруднику — пароль больше не будет показан
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">
              <p className="font-semibold">{issued.fullName}</p>
              <div className="font-mono-tech text-sm">
                <p>Логин: {issued.login}</p>
                <p>Пароль: {issued.password}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={copyCredentials}>
                <Icon name={copied ? 'Check' : 'Copy'} size={16} className="mr-1.5" />
                {copied ? 'Скопировано' : 'Скопировать'}
              </Button>
              <Button className="flex-1" onClick={close}>
                Готово
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Подтвердить сотрудника</DialogTitle>
              <DialogDescription>
                {employee?.fullName}
                {role ? ` — ${roleLabels[role] || role}` : ''}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Пароль для входа в систему
              </label>
              <div className="flex gap-2">
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Не короче 6 символов"
                  className="font-mono-tech"
                  autoFocus
                />
                <Button type="button" variant="outline" onClick={generate}>
                  <Icon name="Shuffle" size={16} className="mr-1.5" />
                  Придумать
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Сотрудник войдёт с ним через «Вход по паролю». Через MAX он сможет заходить
                и без пароля.
              </p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={close}>
                Отмена
              </Button>
              <Button
                className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={saving || password.trim().length < 6}
                onClick={() => onApprove(password.trim())}
              >
                {saving ? (
                  <Icon name="Loader2" size={16} className="mr-1.5 animate-spin" />
                ) : (
                  <Icon name="Check" size={16} className="mr-1.5" />
                )}
                Подтвердить
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ApproveWithPasswordDialog;
