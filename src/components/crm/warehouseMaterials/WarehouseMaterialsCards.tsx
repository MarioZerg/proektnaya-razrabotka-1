import { Badge } from '@/components/ui/badge';
import type { Material } from '@/lib/materialsApi';
import {
  formatRolls,
  remainderLabel,
  stockBarClass,
  stockQtyClass,
  warehouseStatus,
} from '@/components/crm/warehouseMaterials/warehouseMaterialsShared';

interface WarehouseMaterialsCardsProps {
  materials: Material[];
}

/** Мобильный вид склада материалов. Четыре колонки таблицы на телефоне
 *  уезжали вбок — остаток и статус приходилось искать горизонтальной прокруткой. */
const WarehouseMaterialsCards = ({ materials }: WarehouseMaterialsCardsProps) => (
  <div className="space-y-3">
    {materials.map((item) => {
      const status = warehouseStatus(item);
      return (
        <div
          key={item.id}
          className="relative min-w-0 overflow-hidden rounded-lg border border-border bg-card p-3 pl-4"
        >
          <span
            className={`absolute inset-y-0 left-0 w-1.5 ${stockBarClass[status.kind]}`}
          />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 break-words font-semibold">{item.name}</div>
            <Badge
              variant={status.kind === 'empty' ? 'outline' : 'secondary'}
              className={`shrink-0 ${status.className}`}
            >
              {status.label}
            </Badge>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <div>
              <div className={`text-lg tabular-nums leading-none ${stockQtyClass[status.kind]}`}>
                {remainderLabel(item)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{formatRolls(item.warehouseRolls)}</div>
            </div>
          </div>
        </div>
      );
    })}
  </div>
);

export default WarehouseMaterialsCards;
