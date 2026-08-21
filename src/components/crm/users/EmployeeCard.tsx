import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Icon from '@/components/ui/icon';
import { roleLabels } from '@/lib/roles';
import type { Employee } from '@/lib/usersApi';
import { initials, shortName } from '@/components/crm/users/usersShared';

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
    className={`flex items-center gap-2 rounded-lg border p-2.5 transition hover:bg-muted/40 sm:gap-3 sm:p-3 ${
      emp.isActive === false ? 'border-border bg-muted/30' : 'border-border bg-card'
    }`}
  >
    <button
      type="button"
      onClick={() => onOpenCard(emp)}
      className="flex min-w-0 flex-1 items-center gap-2 text-left sm:gap-3"
    >
      <Avatar className="h-8 w-8 shrink-0 sm:h-11 sm:w-11">
        {emp.avatarUrl && <AvatarImage src={emp.avatarUrl} />}
        <AvatarFallback className="text-sm">{initials(emp.fullName)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        {/* «Фамилия И. О.» в одну строку: полное ФИО переносилось на вторую строку,
            из-за чего карточки прыгали по высоте, а на телефоне имя обрывалось
            многоточием. Полное имя остаётся в подсказке и в карточке сотрудника. */}
        <p
          className="flex items-center gap-1.5 truncate text-sm font-semibold leading-tight sm:text-base"
          title={emp.fullName}
        >
          {/* Красный знак: сотрудник подписал Акт о расторжении и ждёт решения.
              Он виден прямо в списке, чтобы заявление не пролежало незамеченным
              — от него зависит, работает человек завтра или нет. */}
          {emp.terminationPending && (
            <Icon
              name="CircleAlert"
              size={16}
              className="shrink-0 text-destructive"
              aria-label="Договор подан на расторжение"
            />
          )}
          <span className="truncate">{shortName(emp.fullName)}</span>
        </p>
        {/* Должность и цех — одной строкой с обрезкой: на телефоне они уходили
            на третью строку и карточка вырастала вдвое. */}
        <div className="mt-0.5 flex items-center gap-x-1.5 truncate text-xs text-muted-foreground">
          <span className="truncate">{roleLabels[emp.role] || 'Без должности'}</span>
          {emp.workshop && <span className="shrink-0">· {emp.workshop}</span>}
          {/* Логин — служебная строка, нужная редко. На узком экране прячем: из-за
              него данные переносились на третью строку и карточка «разбегалась». */}
          <span className="hidden shrink-0 sm:inline">
            · логин <span className="font-mono-tech">{emp.login}</span>
          </span>
          {/* Отключённая учётная запись: человек уволен или ещё не утверждён —
              администратор должен видеть это без открытия карточки. */}
          {emp.isActive === false && (
            <Badge variant="outline" className="shrink-0 text-muted-foreground">
              Отключён
            </Badge>
          )}
          {emp.contractTerminatedAt && (
            <Badge variant="outline" className="shrink-0 border-destructive/40 text-destructive">
              Договор расторгнут
            </Badge>
          )}
        </div>
      </div>
    </button>

    {/* Кнопки всегда справа от имени и всегда на экране — ради этого и делалась карточка. */}
    {/* На телефоне кнопки меньше: тремя кнопками по 40px они съедали половину
        ширины, и на имя не оставалось места. */}
    <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
      {emp.id !== currentUserId && (
        <Button
          size="icon"
          variant="outline"
          className="h-8 w-8 sm:h-10 sm:w-10"
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
        className="h-8 w-8 sm:h-10 sm:w-10"
        title="Редактировать профиль"
        onClick={() => onOpenCard(emp)}
      >
        <Icon name="Pencil" size={14} />
      </Button>
      <Button
        size="icon"
        variant="destructive"
        className="h-8 w-8 sm:h-10 sm:w-10"
        title="Удалить сотрудника"
        onClick={() => onDeleteRequest(emp.id)}
      >
        <Icon name="Trash2" size={14} />
      </Button>
    </div>
  </div>
);

export default EmployeeCard;
