import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Icon from '@/components/ui/icon';
import { roleLabels } from '@/lib/roles';
import type { Employee } from '@/lib/usersApi';
import { initials } from '@/components/crm/users/usersShared';

interface EmployeeCardProps {
  emp: Employee;
  onOpenCard: (emp: Employee) => void;
  onDeleteRequest: (id: number) => void;
  onImpersonate: (emp: Employee) => void;
  currentUserId?: number;
  enteringId: number | null;
}

/**
 * Карточка сотрудника — вместо строки широкой таблицы.
 *
 * В таблице кнопки правки стояли в последнем, девятом столбце: чтобы поправить
 * профиль, администратор каждый раз прокручивал список вправо, терял из вида имя
 * и рисковал открыть чужую карточку. Здесь имя, должность и кнопки видны сразу,
 * прокручивать нечего.
 */
const EmployeeCard = ({
  emp,
  onOpenCard,
  onDeleteRequest,
  onImpersonate,
  currentUserId,
  enteringId,
}: EmployeeCardProps) => (
  <div
    className={`flex items-center gap-3 rounded-lg border p-3 transition hover:bg-muted/40 ${
      emp.isActive === false ? 'border-border bg-muted/30' : 'border-border bg-card'
    }`}
  >
    <button
      type="button"
      onClick={() => onOpenCard(emp)}
      className="flex min-w-0 flex-1 items-center gap-3 text-left"
    >
      <Avatar className="h-11 w-11 shrink-0">
        {emp.avatarUrl && <AvatarImage src={emp.avatarUrl} />}
        <AvatarFallback className="text-sm">{initials(emp.fullName)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold">{emp.fullName}</span>
          {/* Отключённая учётная запись: человек уволен или ещё не утверждён —
              администратор должен видеть это без открытия карточки. */}
          {emp.isActive === false && (
            <Badge variant="outline" className="text-muted-foreground">
              Отключён
            </Badge>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span>{roleLabels[emp.role] || 'Без должности'}</span>
          {emp.workshop && <span>· {emp.workshop}</span>}
          <span>
            · логин <span className="font-mono-tech">{emp.login}</span>
          </span>
        </div>
      </div>
    </button>

    {/* Кнопки всегда справа от имени и всегда на экране — ради этого и делалась карточка. */}
    <div className="flex shrink-0 items-center gap-1.5">
      {emp.id !== currentUserId && (
        <Button
          size="icon"
          variant="outline"
          title="Войти в аккаунт и посмотреть панель сотрудника"
          disabled={enteringId !== null}
          onClick={() => onImpersonate(emp)}
        >
          <Icon
            name={enteringId === emp.id ? 'Loader2' : 'LogIn'}
            size={14}
            className={enteringId === emp.id ? 'animate-spin' : undefined}
          />
        </Button>
      )}
      <Button
        size="icon"
        variant="secondary"
        title="Редактировать профиль"
        onClick={() => onOpenCard(emp)}
      >
        <Icon name="Pencil" size={14} />
      </Button>
      <Button
        size="icon"
        variant="destructive"
        title="Удалить сотрудника"
        onClick={() => onDeleteRequest(emp.id)}
      >
        <Icon name="Trash2" size={14} />
      </Button>
    </div>
  </div>
);

export default EmployeeCard;
