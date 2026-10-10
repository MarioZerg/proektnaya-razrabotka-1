import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { RollDetail } from '@/lib/rollsApi';
import { formatDateTime } from '@/lib/dateUtils';
import { formatQuantity } from '@/lib/formatQuantity';

interface RollStockCardsProps {
  roll: RollDetail['roll'];
  unit: string;
  usedQty: number;
  remainPct: number;
}

const RollStockCards = ({ roll, unit, usedQty, remainPct }: RollStockCardsProps) => (
  <div className="grid gap-4 md:grid-cols-3">
    <Card className="border-border shadow-none md:col-span-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Остаток материала</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-3xl font-bold">
              {formatQuantity(roll.remainingQuantity)} <span className="text-lg font-normal text-muted-foreground">{unit}</span>
            </div>
            <p className="text-sm text-muted-foreground">
              из {formatQuantity(roll.initialQuantity)} {unit} · осталось {Math.round(remainPct)}%
            </p>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            Израсходовано<br />
            <span className="font-medium text-foreground">{formatQuantity(usedQty)} {unit}</span>
          </div>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${remainPct <= 15 ? 'bg-red-500' : remainPct <= 40 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${remainPct}%` }}
          />
        </div>
      </CardContent>
    </Card>

    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Данные рулона</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Смена</span>
          <span className="font-medium">{roll.shiftNumber ?? '—'}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Создан</span>
          <span className="font-medium">{formatDateTime(roll.createdAt)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Завершён</span>
          <span className="font-medium">{roll.completedAt ? formatDateTime(roll.completedAt) : '—'}</span>
        </div>
      </CardContent>
    </Card>
  </div>
);

export default RollStockCards;
