import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import SupplySection from '@/components/crm/marketplaceSupplies/SupplySection';
import { formatDateTime } from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';
import { formatDate } from '@/lib/dateUtils';

const deliveryMethodLabels: Record<string, string> = {
  direct: 'Прямая поставка',
  cross_docking: 'Кросс-докинг',
};

interface OzonFboApplicationCardProps {
  supply: SupplyDetail;
  /** Загрузка товарного состава в пошив — доступна только менеджеру (передаётся, если разрешено). */
  onImportComposition?: () => void;
  importing?: boolean;
}

const OzonFboApplicationCard = ({ supply, onImportComposition, importing }: OzonFboApplicationCardProps) => {
  const closedBoxes = supply.boxes.filter((b) => b.closedAt).length;

  // Сводка в свёрнутом виде: номер заявки и дата поставки — то, по чему
  // поставку узнают, не открывая блок.
  const summary = (
    <>
      <span className="font-mono-tech">{supply.supplyNumber || '—'}</span>
      {supply.supplyDate && <span>· {formatDate(supply.supplyDate)}</span>}
    </>
  );

  return (
    <SupplySection title="Данные OZON FBO" summary={summary}>
      {supply.ozonSupplyOrderId && onImportComposition && (
        <div className="mb-3">
          <Button size="sm" className="w-full sm:w-auto" onClick={onImportComposition} disabled={importing}>
            <Icon
              name={importing ? 'Loader2' : 'Download'}
              size={14}
              className={`mr-1.5 ${importing ? 'animate-spin' : ''}`}
            />
            <span className="sm:hidden">{importing ? 'Загрузка…' : 'Загрузить состав'}</span>
            <span className="hidden sm:inline">{importing ? 'Загрузка...' : 'Загрузить товарный состав'}</span>
          </Button>
        </div>
      )}
      <div className="space-y-2 text-sm">
        <div className="flex flex-col gap-0.5 border-b border-border py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground sm:text-sm">Номер поставки</span>
          <span className="break-all font-medium">{supply.supplyNumber || '—'}</span>
        </div>
        <div className="flex flex-col gap-0.5 border-b border-border py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground sm:text-sm">Номер заявки OZON</span>
          <span className="break-all font-medium">{supply.ozonApplicationNumber || '—'}</span>
        </div>
        <div className="flex flex-col gap-0.5 border-b border-border py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground sm:text-sm">Кластер</span>
          <span className="break-words font-medium">{supply.cluster || '—'}</span>
        </div>
        <div className="flex flex-col gap-0.5 border-b border-border py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground sm:text-sm">Дата / таймслот</span>
          <span className="font-medium">
            {supply.supplyDate ? formatDate(supply.supplyDate) : '—'}
            {supply.timeslot ? ` · ${supply.timeslot}` : ''}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 border-b border-border py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground sm:text-sm">Тип отгрузки</span>
          <span className="font-medium">
            {supply.ozonDeliveryMethod ? deliveryMethodLabels[supply.ozonDeliveryMethod] : '—'}
            {supply.shipmentType ? ` · ${supply.shipmentType}` : ''}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 border-b border-border py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground sm:text-sm">Статус</span>
          <Badge variant={supply.ozonStatus === 'Сформирована' ? 'default' : 'secondary'}>
            {supply.ozonStatus || 'Заполнение данных'}
          </Badge>
        </div>
        <div className="flex flex-col gap-0.5 border-b border-border py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground sm:text-sm">Тип грузоместа</span>
          <span className="font-medium">
            {supply.ozonCargoType === 'PALLET' ? 'Палета' : 'Короб'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 border-b border-border py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground sm:text-sm">Короба</span>
          {supply.boxes.length === 0 ? (
            <span className="font-medium">—</span>
          ) : closedBoxes === supply.boxes.length ? (
            <Badge>Закрыты все {supply.boxes.length}</Badge>
          ) : (
            <span className="font-medium">
              Закрыто {closedBoxes} из {supply.boxes.length}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 border-b border-border py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground sm:text-sm">ID отгрузки в Газельку</span>
          <span className="break-all font-medium">{supply.gazelkaId || '—'}</span>
        </div>
        <div className="flex flex-col gap-0.5 border-b border-border py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground sm:text-sm">Отгрузка в Газельку</span>
          <span className="font-medium">
            {supply.shipToGazelkaAt ? formatDateTime(supply.shipToGazelkaAt) : '—'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground sm:text-sm">Забор Газелькой</span>
          {supply.gazelkaPickup ? (
            <Badge>Со склада</Badge>
          ) : (
            <span className="font-medium">Нет</span>
          )}
        </div>
      </div>
    </SupplySection>
  );
};

export default OzonFboApplicationCard;