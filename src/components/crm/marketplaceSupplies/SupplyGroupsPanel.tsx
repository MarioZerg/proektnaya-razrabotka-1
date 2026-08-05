import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { SupplyGroup } from '@/lib/marketplaceSuppliesApi';

interface SupplyGroupsPanelProps {
  groups: SupplyGroup[];
}

/** Связки заказов Яндекс Маркета в поставке.
 *
 * Покупатель заказывает несколько вещей одним заказом, и ярлык на них выдаётся ОДИН общий.
 * Отгрузить половину такого заказа нельзя: остаток застрянет на складе, а покупателю уедет
 * неполная посылка. Поэтому кладовщик во время сборки должен видеть, какие связки уже
 * собраны, а каким ещё не хватает вещей — до того, как упрётся в блокировку при отгрузке.
 */
const SupplyGroupsPanel = ({ groups }: SupplyGroupsPanelProps) => {
  if (!groups || groups.length === 0) return null;

  const incomplete = groups.filter((g) => !g.isComplete);
  const complete = groups.filter((g) => g.isComplete);

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Icon name="Package" size={18} />
          Связки заказов
          <Badge variant="secondary">
            собрано {complete.length} из {groups.length}
          </Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          У этих заказов один общий ярлык — отгрузить их можно только целиком
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {incomplete.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
            <p className="mb-2 font-semibold text-amber-900">
              Не хватает вещей — поставку отгрузить нельзя
            </p>
            <div className="space-y-1.5">
              {incomplete.map((g) => (
                <div
                  key={g.groupKey}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm text-amber-900"
                >
                  <span className="break-all font-mono-tech">{g.groupKey}</span>
                  <Badge className="bg-amber-600 text-white hover:bg-amber-600">
                    {g.inSupply} из {g.total} — нужно ещё {g.total - g.inSupply}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        {complete.map((g) => (
          <div
            key={g.groupKey}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
          >
            <span className="flex items-center gap-2">
              <Icon name="CircleCheck" size={16} className="text-emerald-600" />
              <span className="break-all font-mono-tech">{g.groupKey}</span>
            </span>
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
              собрана целиком: {g.total}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default SupplyGroupsPanel;
