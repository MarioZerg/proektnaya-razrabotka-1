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
  onOpenManual: () => void;
  onSyncWb: () => void;
  syncing: boolean;
  statusFilter: StatusFilter;
  onStatusChange: (v: StatusFilter) => void;
  marketplaceFilter: MarketplaceFilter;
  onMarketplaceChange: (v: MarketplaceFilter) => void;
  typeFilter: TypeFilter;
  onTypeChange: (v: TypeFilter) => void;
}

const OrdersToolbar = ({
  onOpenManual,
  onSyncWb,
  syncing,
  statusFilter,
  onStatusChange,
  marketplaceFilter,
  onMarketplaceChange,
  typeFilter,
  onTypeChange,
}: OrdersToolbarProps) => {
  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Button className="bg-blue-600 text-white hover:bg-blue-700" onClick={onOpenManual}>
          <Icon name="Plus" size={16} className="mr-1.5" />
          Добавить заказ вручную
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
      </div>

      <div className="flex flex-wrap gap-3">
        <Select value={statusFilter} onValueChange={(v) => onStatusChange(v as StatusFilter)}>
          <SelectTrigger className="w-[200px]">
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
          <SelectTrigger className="w-[160px]">
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
          <SelectTrigger className="w-[160px]">
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