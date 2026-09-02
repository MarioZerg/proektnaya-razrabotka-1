import { Button } from '@/components/ui/button';
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
      </div>
    </>
  );
};

export default OrdersToolbar;