import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';

export type StatusFilter = 'new' | 'in_progress' | 'done' | 'cancelled';
export type MarketplaceFilter = 'all' | 'OZON' | 'WB' | 'Yandex';
export type TypeFilter = 'all' | 'FBO' | 'FBS' | 'Индивидуальный';

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'new', label: 'Новые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'done', label: 'Выполненные' },
  { value: 'cancelled', label: 'Отменённые' },
];

const triggerClass = (active: boolean) =>
  `h-8 w-[calc(50%-0.25rem)] shrink-0 px-2.5 text-xs sm:w-[9rem] ${
    active ? 'border-sky-400 bg-sky-50 text-sky-900' : ''
  }`;

interface OrdersToolbarProps {
  /** Может ли пользователь заводить и загружать заказы. Кладовщик и менеджер смотрят
   * эту вкладку только как справку — управляет заказами администратор. */
  canManage: boolean;
  onOpenManual: () => void;
  onSyncWb: () => void;
  syncing: boolean;
  onSyncOzon: () => void;
  syncingOzon: boolean;
  onSyncYandex: () => void;
  syncingYandex: boolean;
  onRefreshOzonStatuses: () => void;
  refreshingOzon: boolean;
  /** Догрузить отправление OZON по номеру — когда заказа нет на конвейере. */
  onPullByNumber: () => void;
  statusFilter: StatusFilter;
  onStatusChange: (v: StatusFilter) => void;
  statusCounts: Record<StatusFilter, number>;
  marketplaceFilter: MarketplaceFilter;
  onMarketplaceChange: (v: MarketplaceFilter) => void;
  typeFilter: TypeFilter;
  onTypeChange: (v: TypeFilter) => void;
  /** Материалы, встречающиеся в заказах — по ним админ ищет то, что закончилось. */
  materials: string[];
  materialFilter: string;
  onMaterialChange: (v: string) => void;
  /** Снять с конвейера все нетронутые FBS-заказы выбранного материала. */
  onBulkCancel: () => void;
  /** Поиск по номеру заказа. Идёт на сервер — находит заказ любой давности. */
  search: string;
  onSearchChange: (v: string) => void;
  /** Идёт запрос поиска: показываем это в поле, а не пустым списком. */
  searching: boolean;
}

const OrdersToolbar = ({
  canManage,
  onOpenManual,
  onSyncWb,
  syncing,
  onSyncOzon,
  syncingOzon,
  onSyncYandex,
  syncingYandex,
  onRefreshOzonStatuses,
  refreshingOzon,
  onPullByNumber,
  statusFilter,
  onStatusChange,
  statusCounts,
  marketplaceFilter,
  onMarketplaceChange,
  typeFilter,
  onTypeChange,
  materials,
  materialFilter,
  onMaterialChange,
  onBulkCancel,
  search,
  onSearchChange,
  searching,
}: OrdersToolbarProps) => {
  const busyLabel = syncing
    ? 'Загружаем WB...'
    : syncingOzon
      ? 'Загружаем OZON...'
      : syncingYandex
        ? 'Загружаем Яндекс...'
        : refreshingOzon
          ? 'Обновляем статусы OZON...'
          : null;

  const filtersActive =
    marketplaceFilter !== 'all' || typeFilter !== 'all' || materialFilter !== 'all';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <Icon
                  name={busyLabel ? 'Loader2' : 'Ellipsis'}
                  size={16}
                  className={`mr-2 ${busyLabel ? 'animate-spin' : ''}`}
                />
                {busyLabel || 'Действия'}
                <Icon name="ChevronDown" size={14} className="ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuItem onClick={onOpenManual}>
                <Icon name="Plus" size={16} className="mr-2" />
                Индивидуальный заказ
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onPullByNumber}>
                <Icon name="Search" size={16} className="mr-2" />
                Заказ по номеру
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Загрузить с API</DropdownMenuLabel>
              <DropdownMenuItem onClick={onSyncWb} disabled={syncing}>
                <Icon
                  name={syncing ? 'Loader2' : 'RefreshCw'}
                  size={16}
                  className={`mr-2 ${syncing ? 'animate-spin' : ''}`}
                />
                {syncing ? 'Загружаем WB...' : 'Wildberries FBS'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onSyncOzon} disabled={syncingOzon}>
                <Icon
                  name={syncingOzon ? 'Loader2' : 'RefreshCw'}
                  size={16}
                  className={`mr-2 ${syncingOzon ? 'animate-spin' : ''}`}
                />
                {syncingOzon ? 'Загружаем OZON...' : 'OZON FBS'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onSyncYandex} disabled={syncingYandex}>
                <Icon
                  name={syncingYandex ? 'Loader2' : 'RefreshCw'}
                  size={16}
                  className={`mr-2 ${syncingYandex ? 'animate-spin' : ''}`}
                />
                {syncingYandex ? 'Загружаем Яндекс...' : 'Яндекс FBS'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onRefreshOzonStatuses} disabled={refreshingOzon}>
                <Icon
                  name={refreshingOzon ? 'Loader2' : 'RefreshCcw'}
                  size={16}
                  className={`mr-2 ${refreshingOzon ? 'animate-spin' : ''}`}
                />
                {refreshingOzon ? 'Обновляем...' : 'Обновить статусы OZON'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <div className="relative min-w-[12rem] flex-1 sm:max-w-md">
          <Icon
            name={searching ? 'Loader2' : 'Search'}
            size={14}
            className={`absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground ${
              searching ? 'animate-spin' : ''
            }`}
          />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Номер заказа или отправления"
            className="h-8 pl-8 pr-8 text-xs"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              title="Очистить поиск"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
            >
              <Icon name="X" size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-stretch gap-2">
        {STATUS_TABS.map((tab) => {
          const active = statusFilter === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => onStatusChange(tab.value)}
              className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium ${
                active
                  ? 'border-slate-300 bg-white shadow-sm'
                  : 'border-slate-200 bg-slate-50/80 text-slate-600 hover:bg-white'
              }`}
            >
              {tab.label}
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {statusCounts[tab.value]}
              </Badge>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={marketplaceFilter}
          onValueChange={(v) => onMarketplaceChange(v as MarketplaceFilter)}
        >
          <SelectTrigger className={triggerClass(marketplaceFilter !== 'all')}>
            <SelectValue placeholder="Площадка" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все площадки</SelectItem>
            <SelectItem value="OZON">OZON</SelectItem>
            <SelectItem value="WB">Wildberries</SelectItem>
            <SelectItem value="Yandex">Яндекс.Маркет</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => onTypeChange(v as TypeFilter)}>
          <SelectTrigger className={triggerClass(typeFilter !== 'all')}>
            <SelectValue placeholder="Тип" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="FBO">FBO</SelectItem>
            <SelectItem value="FBS">FBS</SelectItem>
            <SelectItem value="Индивидуальный">Индивидуальный</SelectItem>
          </SelectContent>
        </Select>
        <Select value={materialFilter} onValueChange={onMaterialChange}>
          <SelectTrigger className={triggerClass(materialFilter !== 'all')}>
            <SelectValue placeholder="Ткань" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все ткани</SelectItem>
            {materials.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {filtersActive && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-slate-600"
            onClick={() => {
              onMarketplaceChange('all');
              onTypeChange('all');
              onMaterialChange('all');
            }}
          >
            <Icon name="X" size={12} className="mr-1" />
            Сбросить
          </Button>
        )}

        {canManage && materialFilter !== 'all' && (
          <Button variant="destructive" size="sm" className="h-8" onClick={onBulkCancel}>
            <Icon name="Trash2" size={14} className="mr-1.5" />
            Удалить с конвейера
          </Button>
        )}
      </div>
    </div>
  );
};

export default OrdersToolbar;
