import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import {
  formatDateTime,
  marketplaceLogo,
  statusVariant,
} from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';

interface SupplyAssembleHeaderProps {
  supply: SupplyDetail;
  /** Сколько вещей уже уложено в короба. */
  totalBoxedItems: number;
  /** Сколько ещё нести по заявке маркетплейса. */
  remainingToScan: number;
  onBack: () => void;
}

/**
 * Шапка экрана сборки: возврат к поставке, её реквизиты и прогресс.
 *
 * Прогресс здесь не украшение: без него кладовщик держал план поставки в
 * голове и узнавал о недоборе только при попытке её закрыть.
 */
const SupplyAssembleHeader = ({
  supply,
  totalBoxedItems,
  remainingToScan,
  onBack,
}: SupplyAssembleHeaderProps) => (
  <div>
    <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2">
      <Icon name="ChevronLeft" size={16} className="mr-1" />
      К поставке
    </Button>
    <div className="flex items-center gap-3">
      <h1 className="text-xl font-bold">Сборка поставки #{supply.id}</h1>
      <Badge className={statusVariant[supply.status]?.className}>{supply.status}</Badge>
      <span className={marketplaceLogo[supply.marketplace]?.className}>
        {marketplaceLogo[supply.marketplace]?.label || supply.marketplace}
      </span>
      <Badge variant="outline">{supply.type}</Badge>
    </div>
    <p className="mt-1 text-sm text-muted-foreground">
      Номер поставки: {supply.supplyNumber || 'не указан'} · Создана{' '}
      {formatDateTime(supply.createdAt)}
    </p>

    {/* Прогресс сборки: сколько уже в коробах и сколько ещё нести. Без этого
        кладовщик держал план поставки в голове и узнавал о недоборе только
        при попытке её закрыть. */}
    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
      <span>
        В коробах: <b>{totalBoxedItems}</b>
        {supply.totalQuantityMarketplace ? ` из ${supply.totalQuantityMarketplace}` : ''}
      </span>
      {remainingToScan > 0 ? (
        <span className="rounded-full bg-amber-100 px-3 py-0.5 font-semibold text-amber-900">
          Осталось отсканировать: {remainingToScan}
        </span>
      ) : (
        supply.totalQuantityMarketplace != null && (
          <span className="rounded-full bg-emerald-100 px-3 py-0.5 font-semibold text-emerald-800">
            Поставка собрана полностью
          </span>
        )
      )}
    </div>
  </div>
);

export default SupplyAssembleHeader;
