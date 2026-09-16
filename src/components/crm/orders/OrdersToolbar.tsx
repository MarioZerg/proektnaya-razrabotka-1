import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  return (
    <>
      {/* Кнопки добавления и загрузки заказов — только у администратора. Кладовщик и
          менеджер на этой вкладке лишь смотрят информацию, заказами не занимаются. */}
      {canManage && (
      <div className="flex flex-wrap gap-3">
        <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={onOpenManual}>
          <Icon name="Plus" size={16} className="mr-1.5" />
          Индивидуальный заказ
        </Button>
        <Button
          className="bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={onSyncWb}
          disabled={syncing}
        >
          <Icon
            name={syncing ? 'Loader2' : 'RefreshCw'}
            size={16}
            className={`mr-1.5 ${syncing ? 'animate-spin' : ''}`}
          />
          {syncing ? 'Загружаем...' : 'Загрузить заказы с API (WB FBS)'}
        </Button>
        <Button
          className="bg-[#005BFF] text-white hover:bg-[#0047cc]"
          onClick={onSyncOzon}
          disabled={syncingOzon}
        >
          <Icon
            name={syncingOzon ? 'Loader2' : 'RefreshCw'}
            size={16}
            className={`mr-1.5 ${syncingOzon ? 'animate-spin' : ''}`}
          />
          {syncingOzon ? 'Загружаем...' : 'Загрузить заказы с API (OZON FBS)'}
        </Button>
        <Button
          className="bg-[#FFCC00] text-black hover:bg-[#e6b800]"
          onClick={onSyncYandex}
          disabled={syncingYandex}
        >
          <Icon
            name={syncingYandex ? 'Loader2' : 'RefreshCw'}
            size={16}
            className={`mr-1.5 ${syncingYandex ? 'animate-spin' : ''}`}
          />
          {syncingYandex ? 'Загружаем...' : 'Загрузить заказы с API (Яндекс FBS)'}
        </Button>
        <Button variant="outline" onClick={onRefreshOzonStatuses} disabled={refreshingOzon}>
          <Icon
            name={refreshingOzon ? 'Loader2' : 'RefreshCcw'}
            size={16}
            className={`mr-1.5 ${refreshingOzon ? 'animate-spin' : ''}`}
          />
          {refreshingOzon ? 'Обновляем...' : 'Обновить статусы OZON'}
        </Button>
        {/* Аварийная догрузка: заказ есть на OZON, но на конвейер не попал. */}
        <Button variant="outline" onClick={onPullByNumber}>
          <Icon name="Search" size={16} className="mr-1.5" />
          Заказ по номеру
        </Button>
      </div>
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