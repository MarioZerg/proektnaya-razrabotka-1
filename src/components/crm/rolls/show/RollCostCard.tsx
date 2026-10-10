import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { RollDetail } from '@/lib/rollsApi';
import { currencySymbols } from '@/lib/suppliersApi';

interface RollCostCardProps {
  roll: RollDetail['roll'] & { costPerUnit: number };
  unit: string;
}

const RollCostCard = ({ roll, unit }: RollCostCardProps) => (
  <Card className="border-border shadow-none">
    <CardHeader className="pb-3">
      <CardTitle className="text-base">Себестоимость</CardTitle>
    </CardHeader>
    <CardContent className="space-y-2 text-sm">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Поставщик</span>
        <span className="font-medium">{roll.supplierName || '—'}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Цена закупки</span>
        <span className="font-medium">
          {roll.purchasePrice != null
            ? `${roll.purchasePrice} ${currencySymbols[roll.purchaseCurrency || 'RUB'] || roll.purchaseCurrency || ''}`
            : '—'}
        </span>
      </div>
      {/* Курс показываем только для валютных закупок — у рублёвых он равен 1. */}
      {roll.purchaseCurrency && roll.purchaseCurrency !== 'RUB' && (
        <div className="flex justify-between">
          <span className="text-muted-foreground">Курс на день приёмки</span>
          <span className="font-medium">{roll.purchaseRate ?? '—'} ₽</span>
        </div>
      )}
      <div className="flex justify-between">
        <span className="text-muted-foreground">Логистика на {unit}</span>
        <span className="font-medium">
          {(roll.logisticsPerUnit ?? 0).toFixed(2)} ₽
        </span>
      </div>
      <div className="flex justify-between border-t border-border pt-2">
        <span className="font-medium">Итого за 1 {unit}</span>
        <span className="text-base font-bold">{roll.costPerUnit.toFixed(2)} ₽</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Стоимость остатка</span>
        <span className="font-medium">
          {(roll.remainingQuantity * roll.costPerUnit).toFixed(2)} ₽
        </span>
      </div>
    </CardContent>
  </Card>
);

export default RollCostCard;
