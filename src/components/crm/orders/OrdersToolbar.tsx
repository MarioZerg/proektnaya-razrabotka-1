import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

  return (
    <>
      {/* Загрузка, ручной заказ и догрузка по номеру — только у администратора.
          Раньше это был ряд из шести кнопок, и на экране не оставалось места
          под сам список. Кладовщик и менеджер вкладку только смотрят. */}
      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
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

      {/* ПОИСК ПО НОМЕРУ — ОТДЕЛЬНО ОТ ФИЛЬТРОВ И ВЫШЕ НИХ.
          Фильтры просеивают то, что уже на экране, а список показывает лишь свежую
          часть истории: заказа прошлого квартала в нём нет вовсе. Поиск спрашивает
          сервер напрямую и находит заказ любой давности, поэтому пока в поле что-то
          введено, фильтры к результату не применяются — иначе найденный заказ снова
          пропал бы за выбранной вкладкой статуса. */}
      <div className="relative w-full sm:max-w-md">
        <Icon
          name={searching ? 'Loader2' : 'Search'}
          size={16}
          className={`absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground ${
            searching ? 'animate-spin' : ''
          }`}
        />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Поиск по номеру заказа или отправления"
          className="pl-9 pr-9"
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

      <div className="flex flex-wrap gap-3">
        <Select value={statusFilter} onValueChange={(v) => onStatusChange(v as StatusFilter)}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">Новые заказы</SelectItem>
            <SelectItem value="in_progress">В работе</SelectItem>
            <SelectItem value="done">Выполненные</SelectItem>
            <SelectItem value="cancelled">Отменённые</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={marketplaceFilter}
          onValueChange={(v) => onMarketplaceChange(v as MarketplaceFilter)}
        >
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все маркетплейсы</SelectItem>
            <SelectItem value="OZON">OZON</SelectItem>
            <SelectItem value="WB">Wildberries</SelectItem>
            <SelectItem value="Yandex">Яндекс.Маркет</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => onTypeChange(v as TypeFilter)}>
          <SelectTrigger className="w-full sm:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            <SelectItem value="FBO">FBO</SelectItem>
            <SelectItem value="FBS">FBS</SelectItem>
            <SelectItem value="Индивидуальный">Индивидуальный</SelectItem>
          </SelectContent>
        </Select>

        {/* Материал — по нему снимают заказы, когда ткань кончилась. */}
        <Select value={materialFilter} onValueChange={onMaterialChange}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue placeholder="Все материалы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все материалы</SelectItem>
            {materials.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Кнопка появляется только когда материал выбран: снимать «всё подряд»
            нельзя — это отмена сотен заказов и у нас, и на маркетплейсе. */}
        {canManage && materialFilter !== 'all' && (
          <Button variant="destructive" onClick={onBulkCancel}>
            <Icon name="Trash2" size={16} className="mr-1.5" />
            Удалить с конвейера
          </Button>
        )}
      </div>
    </>
  );
};

export default OrdersToolbar;