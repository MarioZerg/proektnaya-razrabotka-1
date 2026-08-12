import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { roleLabels } from '@/lib/roles';
import type { Employee } from '@/lib/usersApi';
import { roleOptions, workshopOptions } from '@/components/crm/users/usersShared';
import EmployeeCard from '@/components/crm/users/EmployeeCard';

interface EmployeesTableProps {
  loading: boolean;
  filtered: Employee[];
  roleFilter: string;
  setRoleFilter: (value: string) => void;
  workshopFilter: string;
  setWorkshopFilter: (value: string) => void;
  /** Поиск по имени, логину, телефону или почте. */
  search: string;
  setSearch: (value: string) => void;
  onOpenCard: (emp: Employee) => void;
  onDeleteRequest: (id: number) => void;
  /** Войти в аккаунт сотрудника и посмотреть его рабочую панель. */
  onImpersonate: (emp: Employee) => void;
  /** Кто смотрит список — на своей строке кнопка входа не нужна. */
  currentUserId?: number;
  /** Сотрудник, в чей аккаунт сейчас выполняется вход — на его кнопке крутится ожидание. */
  enteringId: number | null;
}

/**
 * Список сотрудников карточками.
 *
 * Раньше это была таблица из девяти столбцов: даты создания и обновления занимали
 * половину ширины, а кнопки правки уезжали за правый край. Чтобы поправить профиль,
 * администратор прокручивал список вбок и терял из вида имя сотрудника.
 *
 * Здесь на строке только то, по чему человека узнают, — фото, имя, должность, цех и
 * логин, — а кнопки всегда на экране. Технические даты остались в карточке сотрудника:
 * они нужны редко, а места занимали больше всего.
 */
const EmployeesTable = ({
  loading,
  filtered,
  roleFilter,
  setRoleFilter,
  workshopFilter,
  setWorkshopFilter,
  search,
  setSearch,
  onOpenCard,
  onDeleteRequest,
  onImpersonate,
  enteringId,
  currentUserId,
}: EmployeesTableProps) => {
  return (
    <div className="space-y-3">
      {/* Поиск отдельной строкой сверху: в списке два десятка человек, и найти нужного
          по имени быстрее, чем перебирать фильтры по должности и цеху. */}
      <div className="relative max-w-xl">
        <Icon
          name="Search"
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Поиск: имя, логин, телефон или почта"
          className="h-10 pl-9 pr-9"
          autoComplete="off"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            title="Очистить поиск"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <Icon name="X" size={16} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все роли</SelectItem>
            {roleOptions.map((r) => (
              <SelectItem key={r} value={r}>
                {roleLabels[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={workshopFilter} onValueChange={setWorkshopFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все цеха</SelectItem>
            {workshopOptions.map((w) => (
              <SelectItem key={w} value={w}>
                {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!loading && (
          <p className="text-sm text-muted-foreground">
            Сотрудников: <span className="text-base font-bold text-foreground">{filtered.length}</span>
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {search.trim()
            ? 'По этому запросу никого не нашлось'
            : 'Сотрудников пока нет.'}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((emp) => (
            <EmployeeCard
              key={emp.id}
              emp={emp}
              onOpenCard={onOpenCard}
              onDeleteRequest={onDeleteRequest}
              onImpersonate={onImpersonate}
              currentUserId={currentUserId}
              enteringId={enteringId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default EmployeesTable;
