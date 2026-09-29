import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { stageLabels, type LogStage } from '@/lib/logsApi';

interface LogsFiltersProps {
  stage: LogStage | '';
  setStage: (v: LogStage | '') => void;
  userId: number | '';
  setUserId: (v: number | '') => void;
  search: string;
  setSearch: (v: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  users: { id: number; name: string }[];
  activeFiltersCount: number;
  onToday: () => void;
  onYesterday: () => void;
  onWeek: () => void;
  onReset: () => void;
  onReload: () => void;
}

const periodBtn =
  'h-11 min-w-0 sm:h-9 sm:w-auto';

/** Фильтры журнала: период, этап работы, сотрудник и поиск по номеру заказа. */
const LogsFilters = ({
  stage,
  setStage,
  userId,
  setUserId,
  search,
  setSearch,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  users,
  activeFiltersCount,
  onToday,
  onYesterday,
  onWeek,
  onReset,
  onReload,
}: LogsFiltersProps) => (
  <div className="space-y-3 rounded-lg border border-border p-3">
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      <Button variant="outline" className={periodBtn} onClick={onToday}>
        Сегодня
      </Button>
      <Button variant="outline" className={periodBtn} onClick={onYesterday}>
        Вчера
      </Button>
      <Button variant="outline" className={periodBtn} onClick={onWeek}>
        Неделя
      </Button>
      <Button variant="outline" className={periodBtn} onClick={onReload}>
        <Icon name="RefreshCw" size={14} className="mr-1.5" />
        Обновить
      </Button>
      {activeFiltersCount > 0 && (
        <Button variant="ghost" className={`${periodBtn} col-span-2 sm:col-span-1`} onClick={onReset}>
          <Icon name="X" size={14} className="mr-1.5" />
          Сбросить ({activeFiltersCount})
        </Button>
      )}
    </div>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <div className="space-y-1.5">
        <Label className="text-xs">Дата с</Label>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-11 sm:h-10"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Дата по</Label>
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="h-11 sm:h-10"
        />
      </div>
      <div className="col-span-2 space-y-1.5 lg:col-span-1">
        <Label className="text-xs">Этап</Label>
        <Select
          value={stage || 'all'}
          onValueChange={(v) => setStage(v === 'all' ? '' : (v as LogStage))}
        >
          <SelectTrigger className="h-11 sm:h-10">
            <SelectValue placeholder="Все этапы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все этапы</SelectItem>
            {(Object.keys(stageLabels) as LogStage[]).map((s) => (
              <SelectItem key={s} value={s}>
                {stageLabels[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 space-y-1.5 lg:col-span-1">
        <Label className="text-xs">Сотрудник</Label>
        <Select
          value={userId ? String(userId) : 'all'}
          onValueChange={(v) => setUserId(v === 'all' ? '' : Number(v))}
        >
          <SelectTrigger className="h-11 sm:h-10">
            <SelectValue placeholder="Все сотрудники" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все сотрудники</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>
                {u.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 space-y-1.5 lg:col-span-1">
        <Label className="text-xs">Поиск</Label>
        <Input
          placeholder="Номер заказа или штрихкод"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 sm:h-10"
        />
      </div>
    </div>
  </div>
);

export default LogsFilters;
