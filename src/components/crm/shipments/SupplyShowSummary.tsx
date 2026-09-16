import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { formatQuantity } from '@/lib/formatQuantity';
import type { ShipmentDetail } from '@/lib/shipmentsApi';

/**
 * Шапка приёмки: четыре плитки итогов, форма логистики и подсказка про правку
 * метража. Логика и разметка 1:1 перенесены из SupplyShow.
 */
interface Props {
  detail: ShipmentDetail;
  totals: { count: number; inStorage: number; quantity: number };
  isPending: boolean;
  isAdmin: boolean;
  logisticsValue: string;
  setLogisticsValue: (v: string) => void;
  savingLogistics: boolean;
  onSaveLogistics: () => void;
}

const SupplyShowSummary = ({
  detail,
  totals,
  isPending,
  isAdmin,
  logisticsValue,
  setLogisticsValue,
  savingLogistics,
  onSaveLogistics,
}: Props) => (
  <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="shadow-none">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">Статус</p>
          <Badge variant={isPending ? 'secondary' : 'default'} className="mt-1">
            {isPending ? 'Ожидает подтверждения' : detail.status}
          </Badge>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">Рулонов</p>
          <p className="text-2xl font-bold">{totals.count}</p>
          <p className="text-xs text-muted-foreground">на складе: {totals.inStorage}</p>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">Всего метров/шт</p>
          <p className="text-2xl font-bold">{formatQuantity(totals.quantity)}</p>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">Логистика</p>
          <p className="text-2xl font-bold">
            {detail.logisticsCost ? `${detail.logisticsCost.toLocaleString('ru-RU')} ₽` : '—'}
          </p>
          {!detail.logisticsCost && (
            <p className="text-xs text-amber-700">не указана</p>
          )}
        </CardContent>
      </Card>
    </div>

    {/* Счёт за перевозку часто приходит позже машины. Дозаполнить сумму можно
        только пока её нет: по проставленной логистике уже считались недостачи. */}
    {isAdmin && !detail.logisticsCost && !isPending && (
      <Card className="border-amber-300 bg-amber-50 shadow-none">
        <CardContent className="flex min-w-0 flex-wrap items-end gap-3 py-4">
          <div className="min-w-0 flex-1 space-y-1.5 sm:flex-none">
            <Label className="text-amber-900">Логистика за поставку, ₽</Label>
            <Input
              inputMode="decimal"
              placeholder="25450"
              className="w-full bg-white sm:w-40"
              value={logisticsValue}
              onChange={(e) => setLogisticsValue(e.target.value)}
            />
          </div>
          <Button onClick={onSaveLogistics} disabled={savingLogistics}>
            {savingLogistics ? 'Сохранение...' : 'Указать логистику'}
          </Button>
          <p className="text-xs text-amber-800">
            Разделится поровну на все метры приёмки и войдёт в себестоимость.
            Указать можно один раз
          </p>
        </CardContent>
      </Card>
    )}

    {/* Прямая инструкция администратору: без неё правку метража не находили —
        искали отдельную кнопку «Редактировать», которой тут нет и не будет. */}
    {isAdmin && !isPending && totals.inStorage > 0 && (
      <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
        <Icon name="Pencil" size={16} className="mt-0.5 shrink-0 text-primary" />
        <p className="text-sm">
          <span className="font-medium">Метраж рулона правится прямо в таблице:</span>{' '}
          нажмите на число в столбце «Метраж» — оно обведено пунктиром у тех рулонов,
          которые ещё целыми лежат на складе. Рулоны в цехе и початые изменить нельзя
        </p>
      </div>
    )}
  </>
);

export default SupplyShowSummary;
