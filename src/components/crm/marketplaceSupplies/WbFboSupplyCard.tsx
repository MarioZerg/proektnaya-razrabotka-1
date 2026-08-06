import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { formatDate } from '@/lib/dateUtils';
import { updateSupply, type SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import { fetchWbWarehouses, type WbWarehouse } from '@/lib/wbFboApi';

interface WbFboSupplyCardProps {
  supply: SupplyDetail;
  onReload: () => void;
  /** Редактировать данные поставки может менеджер (или админ). */
  isManager: boolean;
}

const cargoLabel = (t: string | null) => (t === 'PALLET' ? 'Палета' : 'Короб');

/** Данные поставки WB FBO. У WB нет API заявок FBO, поэтому поля заполняются вручную (номер,
 * тип грузоместа, дата на воротах, кол-во), а склад выбирается из списка складов WB (подгружается
 * по API). Вид как у OZON FBO: просмотр + кнопка «Редактировать данные». */
const WbFboSupplyCard = ({ supply, onReload, isManager }: WbFboSupplyCardProps) => {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [supplyNumber, setSupplyNumber] = useState(supply.supplyNumber ?? '');
  const [cargoType, setCargoType] = useState<'BOX' | 'PALLET'>(
    supply.ozonCargoType === 'PALLET' ? 'PALLET' : 'BOX'
  );
  const [supplyDate, setSupplyDate] = useState(supply.supplyDate ? supply.supplyDate.slice(0, 10) : '');
  const [cluster, setCluster] = useState(supply.cluster ?? '');
  const [packagingCount, setPackagingCount] = useState(
    supply.packagingCount != null ? String(supply.packagingCount) : ''
  );

  const [warehouses, setWarehouses] = useState<WbWarehouse[]>([]);
  const [whLoading, setWhLoading] = useState(false);
  const [whError, setWhError] = useState<string | null>(null);

  // Список складов WB подгружаем только когда менеджер вошёл в режим редактирования.
  useEffect(() => {
    if (!editing || warehouses.length > 0) return;
    setWhLoading(true);
    setWhError(null);
    fetchWbWarehouses()
      .then(setWarehouses)
      .catch((e) => setWhError(e instanceof Error ? e.message : 'Не удалось загрузить склады WB'))
      .finally(() => setWhLoading(false));
  }, [editing, warehouses.length]);

  const startEdit = () => {
    setSupplyNumber(supply.supplyNumber ?? '');
    setCargoType(supply.ozonCargoType === 'PALLET' ? 'PALLET' : 'BOX');
    setSupplyDate(supply.supplyDate ? supply.supplyDate.slice(0, 10) : '');
    setCluster(supply.cluster ?? '');
    setPackagingCount(supply.packagingCount != null ? String(supply.packagingCount) : '');
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSupply(supply.id, {
        supplyNumber,
        ozonCargoType: cargoType,
        packagingType: cargoType === 'PALLET' ? 'pallets' : 'boxes',
        supplyDate: supplyDate ? `${supplyDate}T00:00:00` : '',
        cluster,
        packagingCount: packagingCount === '' ? null : Number(packagingCount),
      });
      toast({ title: 'Данные поставки сохранены' });
      setEditing(false);
      onReload();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const packagingUnit = supply.ozonCargoType === 'PALLET' ? 'палет' : 'коробов';

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Данные поставки WB FBO</CardTitle>
        {isManager && !editing && (
          <Button size="sm" variant="outline" onClick={startEdit}>
            <Icon name="Pencil" size={14} className="mr-1.5" />
            Редактировать данные
          </Button>
        )}
      </CardHeader>

      {!editing ? (
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">Номер поставки</span>
            <span className="font-medium">{supply.supplyNumber || '—'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">Тип грузоместа</span>
            <span className="font-medium">{cargoLabel(supply.ozonCargoType)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">Дата поставки на воротах</span>
            <span className="font-medium">{supply.supplyDate ? formatDate(supply.supplyDate) : '—'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">Склад</span>
            <span className="font-medium">{supply.cluster || '—'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">Количество {packagingUnit}</span>
            <span className="font-medium">{supply.packagingCount ?? '—'}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-muted-foreground">Статус (наша система)</span>
            <Badge variant={supply.status === 'Выполнена' ? 'default' : 'secondary'}>{supply.status}</Badge>
          </div>
        </CardContent>
      ) : (
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Номер поставки</Label>
              <Input
                value={supplyNumber}
                onChange={(e) => setSupplyNumber(e.target.value)}
                placeholder="Номер поставки из ЛК WB"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Тип грузоместа</Label>
              <Select value={cargoType} onValueChange={(v) => setCargoType(v as 'BOX' | 'PALLET')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BOX">Короб</SelectItem>
                  <SelectItem value="PALLET">Палета</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Дата поставки на воротах</Label>
              <Input type="date" value={supplyDate} onChange={(e) => setSupplyDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Количество {cargoType === 'PALLET' ? 'палет' : 'коробов'}</Label>
              <Input
                type="number"
                min={0}
                value={packagingCount}
                onChange={(e) => setPackagingCount(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Склад WB</Label>
            <Select value={cluster} onValueChange={setCluster} disabled={whLoading}>
              <SelectTrigger>
                <SelectValue placeholder={whLoading ? 'Загрузка складов WB...' : '— Выберите склад —'} />
              </SelectTrigger>
              <SelectContent>
                {whError ? (
                  <div className="px-2 py-1.5 text-sm text-destructive">{whError}</div>
                ) : warehouses.length === 0 && !whLoading ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Список складов пуст</div>
                ) : (
                  warehouses.map((w) => (
                    <SelectItem key={`${w.id}-${w.name}`} value={w.name}>
                      {w.name}
                      {w.address ? ` · ${w.address}` : ''}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Список складов приёмки подгружается напрямую из WildBerries по API.
            </p>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" /> : null}
              Сохранить
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Отмена
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
};

export default WbFboSupplyCard;
