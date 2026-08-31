import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { printBarcodes } from '@/lib/printBarcodes';
import { formatQuantity } from '@/lib/formatQuantity';
import { ROLL_LOW_STOCK_THRESHOLD } from '@/components/crm/rolls/rollsShared';
import type { Roll } from '@/lib/rollsApi';

interface LowStockPrintCardProps {
  /** Заканчивающиеся рулоны — те же, что считает виджет на главной. */
  rolls: Roll[];
}

/** Стикер одного рулона с пометкой про остаток. */
const toSticker = (r: Roll) => {
  const unit = r.unit || 'пог.м';
  return {
    code: r.barcode,
    label: `${r.materialName || 'Материал'} ${formatQuantity(r.initialQuantity)} ${unit}`.trim(),
    // Главное на стикере: сколько осталось и что с рулоном делать. Закройщик
    // читает это, не заглядывая в систему.
    note: `Осталось ${formatQuantity(r.remainingQuantity)} ${unit} — закрыть рулон`,
    receivedAt: r.createdAt,
  };
};

/**
 * Печать стикеров для заканчивающихся рулонов.
 *
 * Зачем. Рулон с остатком меньше порога надо доработать и закрыть, иначе он
 * годами кочует по цеху и висит в остатках. Но закройщик про это не знает:
 * наклейка на таком рулоне часто уже потеряна или затёрта — он перематывался,
 * лежал в стеллаже, его таскали между сменами. Без штрихкода рулон не
 * отсканировать, и человек берёт следующий, целый.
 *
 * Кладовщик печатает ленту сразу на все такие рулоны, проходит по цеху и
 * переклеивает. На стикере крупно, в рамке — сколько осталось и что рулон надо
 * закрыть. Дальше закройщик видит это глазами, без всякой системы.
 */
const LowStockPrintCard = ({ rolls }: LowStockPrintCardProps) => {
  if (rolls.length === 0) return null;

  const printAll = () =>
    printBarcodes(rolls.map(toSticker), `Стикеры заканчивающихся рулонов (${rolls.length})`);

  return (
    <Card className="border-amber-200 bg-amber-50/40">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700">
              <Icon name="Printer" size={18} />
            </span>
            <div>
              <p className="text-sm font-semibold">
                Стикеры для заканчивающихся рулонов · {rolls.length}
              </p>
              <p className="text-xs text-muted-foreground">
                Меньше {ROLL_LOW_STOCK_THRESHOLD} пог.м. Переклейте стикер — закройщик
                увидит остаток и закроет рулон
              </p>
            </div>
          </div>
          <Button onClick={printAll} className="gap-2">
            <Icon name="Printer" size={16} />
            Напечатать все ({rolls.length})
          </Button>
        </div>

        {/* Поштучно: рулон нашёлся не сразу или стикер испортился при наклейке —
            печатать всю ленту заново ради одного рулона незачем. */}
        <div className="space-y-1.5">
          {rolls.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-background p-2 text-sm"
            >
              <span className="font-mono text-xs font-medium">{r.barcode}</span>
              <span className="min-w-0 flex-1 truncate">{r.materialName}</span>
              <span className="font-semibold text-amber-700">
                {formatQuantity(r.remainingQuantity)} {r.unit || 'пог.м'}
              </span>
              {r.workshopName && (
                <span className="text-xs text-muted-foreground">
                  {r.workshopName}
                  {r.shiftNumber ? ` · смена ${r.shiftNumber}` : ''}
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => printBarcodes([toSticker(r)], `Стикер рулона ${r.barcode}`)}
              >
                <Icon name="Printer" size={14} />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default LowStockPrintCard;
