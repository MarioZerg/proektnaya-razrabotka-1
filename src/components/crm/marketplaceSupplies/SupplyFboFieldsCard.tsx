import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import { formatDateTime } from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';

interface SupplyFboFieldsCardProps {
  supply: SupplyDetail;
  supplyNumber: string;
  setSupplyNumber: (value: string) => void;
  supplyBarcode: string;
  setSupplyBarcode: (value: string) => void;
  cluster: string;
  setCluster: (value: string) => void;
  gazelkaId: string;
  setGazelkaId: (value: string) => void;
  comment: string;
  setComment: (value: string) => void;
  saving: boolean;
  onSave: () => void;
}

const SupplyFboFieldsCard = ({
  supply,
  supplyNumber,
  setSupplyNumber,
  supplyBarcode,
  setSupplyBarcode,
  cluster,
  setCluster,
  gazelkaId,
  setGazelkaId,
  comment,
  setComment,
  saving,
  onSave,
}: SupplyFboFieldsCardProps) => {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-4 rounded-md border border-border p-4">
        <h2 className="font-semibold">Данные поставки</h2>
        <p className="text-xs text-muted-foreground">
          Wildberries не отдаёт данные FBO-поставок по API. Заполните поля вручную из личного
          кабинета продавца WB.
        </p>
        <div className="space-y-1.5">
          <Label>Номер поставки</Label>
          <Input
            value={supplyNumber}
            onChange={(e) => setSupplyNumber(e.target.value)}
            placeholder="Номер поставки из личного кабинета WB"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Штрихкод поставки</Label>
          <Input
            value={supplyBarcode}
            onChange={(e) => setSupplyBarcode(e.target.value)}
            placeholder="Штрихкод поставки из личного кабинета WB"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Кластер / регион</Label>
          <Input value={cluster} onChange={(e) => setCluster(e.target.value)} placeholder="Например: Москва, МО и Дальние регионы" />
        </div>
        <div className="space-y-1.5">
          <Label>id Газельки</Label>
          <Input value={gazelkaId} onChange={(e) => setGazelkaId(e.target.value)} placeholder="Номер рейса развоза" />
        </div>
        <div className="space-y-1.5">
          <Label>Комментарий</Label>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
        </div>
        <Button onClick={onSave} disabled={saving}>
          {saving ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </div>

      <div className="space-y-4 rounded-md border border-border p-4">
        <h2 className="font-semibold">Даты этапов</h2>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">Создана</span>
            <span className="font-medium">{formatDateTime(supply.createdAt)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">Отгрузка в Газельку</span>
            <span className="font-medium">
              {supply.shipToGazelkaAt ? formatDateTime(supply.shipToGazelkaAt) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">Отгрузка в маркетплейс</span>
            <span className="font-medium">
              {supply.shipToMarketplaceAt ? formatDateTime(supply.shipToMarketplaceAt) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Выполнена</span>
            <span className="font-medium">
              {supply.completedAt ? formatDateTime(supply.completedAt) : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupplyFboFieldsCard;