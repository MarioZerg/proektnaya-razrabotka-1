import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';
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

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Данные поставки OZON FBO</CardTitle>
        {supply.ozonSupplyOrderId && onImportComposition && (
          <Button size="sm" onClick={onImportComposition} disabled={importing}>
            <Icon
              name={importing ? 'Loader2' : 'Download'}
              size={14}
              className={`mr-1.5 ${importing ? 'animate-spin' : ''}`}
            />
            {importing ? 'Загрузка...' : 'Загрузить товарный состав'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Номер поставки (ID заявки OZON)</span>
          <span className="font-medium">{supply.supplyNumber || '—'}</span>
        </div>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Номер заявки OZON</span>
          <span className="font-medium">{supply.ozonApplicationNumber || '—'}</span>
        </div>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Кластер (склад)</span>
          <span className="font-medium">{supply.cluster || '—'}</span>
        </div>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Дата поставки / таймслот</span>
          <span className="font-medium">
            {supply.supplyDate ? formatDate(supply.supplyDate) : '—'}
            {supply.timeslot ? ` · ${supply.timeslot}` : ''}
          </span>
        </div>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Тип отгрузки</span>
          <span className="font-medium">
            {supply.ozonDeliveryMethod ? deliveryMethodLabels[supply.ozonDeliveryMethod] : '—'}
            {supply.shipmentType ? ` · ${supply.shipmentType}` : ''}
          </span>
        </div>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Статус</span>
          <Badge variant={supply.ozonStatus === 'Сформирована' ? 'default' : 'secondary'}>
            {supply.ozonStatus || 'Заполнение данных'}
          </Badge>
        </div>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Тип грузоместа</span>
          <span className="font-medium">
            {supply.ozonCargoType === 'PALLET' ? 'Палета' : 'Короб'}
          </span>
        </div>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Короба</span>
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
        <div className="flex items-center justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">ID отгрузки в Газельку</span>
          <span className="font-medium">{supply.gazelkaId || '—'}</span>
        </div>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Дата отгрузки в Газельку</span>
          <span className="font-medium">
            {supply.shipToGazelkaAt ? formatDateTime(supply.shipToGazelkaAt) : '—'}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-muted-foreground">Забор Газелькой</span>
          {supply.gazelkaPickup ? (
            <Badge>Забор Газелькой со склада</Badge>
          ) : (
            <span className="font-medium">Нет</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default OzonFboApplicationCard;
