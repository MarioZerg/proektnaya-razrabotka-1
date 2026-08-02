import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import type { SupplyDetail, PackagingType } from '@/lib/marketplaceSuppliesApi';
import { formatDateTime } from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';

const deliveryMethodLabels: Record<string, string> = {
  direct: 'Прямая поставка',
  cross_docking: 'Кросс-докинг',
};

interface OzonFboEditFields {
  gazelkaId: string;
  shipToGazelkaAt: string;
  packagingType: PackagingType | '';
  packagingCount: string;
  gazelkaPickup: boolean;
}

interface OzonFboApplicationCardProps {
  supply: SupplyDetail;
  canEdit: boolean;
  saving: boolean;
  onSave: (fields: OzonFboEditFields) => Promise<void>;
}

const OzonFboApplicationCard = ({ supply, canEdit, saving, onSave }: OzonFboApplicationCardProps) => {
  const [editOpen, setEditOpen] = useState(false);
  const [gazelkaId, setGazelkaId] = useState('');
  const [shipToGazelkaAt, setShipToGazelkaAt] = useState('');
  const [packagingType, setPackagingType] = useState<PackagingType | ''>('');
  const [packagingCount, setPackagingCount] = useState('');
  const [gazelkaPickup, setGazelkaPickup] = useState(false);

  const openEdit = () => {
    setGazelkaId(supply.gazelkaId || '');
    setShipToGazelkaAt(supply.shipToGazelkaAt ? supply.shipToGazelkaAt.slice(0, 10) : '');
    setPackagingType(supply.packagingType || '');
    setPackagingCount(supply.packagingCount != null ? String(supply.packagingCount) : '');
    setGazelkaPickup(supply.gazelkaPickup);
    setEditOpen(true);
  };

  const handleSave = async () => {
    await onSave({
      gazelkaId,
      shipToGazelkaAt: shipToGazelkaAt ? `${shipToGazelkaAt}T00:00:00` : '',
      packagingType,
      packagingCount,
      gazelkaPickup,
    });
    setEditOpen(false);
  };

  const packagingLabel = supply.packagingType === 'pallets' ? 'палет' : 'коробов';

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Данные поставки OZON FBO</CardTitle>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={openEdit}>
            <Icon name="Pencil" size={14} className="mr-1.5" />
            Редактировать
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
            {supply.supplyDate ? new Date(supply.supplyDate).toLocaleDateString('ru-RU') : '—'}
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
          <span className="text-muted-foreground">ID отгрузки в Газельку</span>
          <span className="font-medium">{supply.gazelkaId || '—'}</span>
        </div>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Дата отгрузки в Газельку</span>
          <span className="font-medium">
            {supply.shipToGazelkaAt ? formatDateTime(supply.shipToGazelkaAt) : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between border-b border-border pb-2">
          <span className="text-muted-foreground">Тип поставки (упаковка)</span>
          <span className="font-medium">
            {supply.packagingType === 'boxes' ? 'Короба' : supply.packagingType === 'pallets' ? 'Палеты' : '—'}
            {supply.packagingCount != null ? ` · ${supply.packagingCount} ${packagingLabel}` : ''}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Забор Газелькой</span>
          {supply.gazelkaPickup ? (
            <Badge>Забор Газелькой со склада</Badge>
          ) : (
            <span className="font-medium">Нет</span>
          )}
        </div>
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Редактирование заявки OZON FBO</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>ID отгрузки в Газельку</Label>
              <Input value={gazelkaId} onChange={(e) => setGazelkaId(e.target.value)} placeholder="Номер рейса развоза" />
            </div>
            <div className="space-y-1.5">
              <Label>Дата отгрузки в Газельку</Label>
              <Input type="date" value={shipToGazelkaAt} onChange={(e) => setShipToGazelkaAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Тип поставки</Label>
              <Select value={packagingType} onValueChange={(v) => setPackagingType(v as PackagingType)}>
                <SelectTrigger>
                  <SelectValue placeholder="-- Короба или палеты --" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="boxes">Короба</SelectItem>
                  <SelectItem value="pallets">Палеты</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <Label htmlFor="gazelka-pickup" className="cursor-pointer">
                Забор Газелькой
              </Label>
              <Switch id="gazelka-pickup" checked={gazelkaPickup} onCheckedChange={setGazelkaPickup} />
            </div>
            {gazelkaPickup && (
              <p className="text-xs text-muted-foreground">
                На заявке будет отмечено: «Забор Газелькой со склада»
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Кол-во {packagingType === 'pallets' ? 'палет' : 'коробов'}</Label>
              <Input
                type="number"
                min="0"
                value={packagingCount}
                onChange={(e) => setPackagingCount(e.target.value)}
                disabled={!packagingType}
              />
            </div>
            <Button className="w-full" onClick={handleSave} disabled={saving}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default OzonFboApplicationCard;