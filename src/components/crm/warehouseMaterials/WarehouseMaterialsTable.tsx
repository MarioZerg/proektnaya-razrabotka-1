import Icon from '@/components/ui/icon';
import type { MaterialTypeGroup } from '@/components/crm/warehouseMaterials/warehouseMaterialsShared';
import {
  formatRolls,
  typeTotals,
} from '@/components/crm/warehouseMaterials/warehouseMaterialsShared';
import WarehouseMaterialsCards from '@/components/crm/warehouseMaterials/WarehouseMaterialsCards';

interface WarehouseMaterialsTableProps {
  loading: boolean;
  /** FRONTEND-ONLY: сбой GET — не писать «материалов пока нет». */
  error?: string | null;
  groups: MaterialTypeGroup[];
  /** Фильтры отсеяли всё — текст другой, чем у пустого справочника. */
  filtered: boolean;
}

const GroupHeader = ({ group }: { group: MaterialTypeGroup }) => {
  const totals = typeTotals(group.items);
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border bg-muted/50 px-4 py-2">
      <span className="text-sm font-semibold">{group.type.name}</span>
      <span className="text-xs text-muted-foreground">
        {group.items.length} поз.
        {totals.qtyLabel ? ` · ${totals.qtyLabel}` : ''}
        {' · '}
        {formatRolls(totals.rolls)}
      </span>
    </div>
  );
};

/** Склад материалов: три колонки сеткой на ширину окна и на телефоне, и на компьютере.
 *  Обычная таблица уезжала вбок, и остаток приходилось искать прокруткой. */
const WarehouseMaterialsTable = ({
  loading,
  error = null,
  groups,
  filtered,
}: WarehouseMaterialsTableProps) => {
  if (loading && groups.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (groups.length === 0) {
    if (error) return null;
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
        <Icon name="PackageSearch" size={28} className="mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium">
          {filtered ? 'Ничего не подошло' : 'Материалов пока нет'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {filtered
            ? 'Сбросьте фильтр или поиск — в этой выборке сейчас пусто'
            : 'Добавьте их в разделе «Настройки → Материалы»'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.type.id} className="min-w-0 overflow-hidden rounded-md border border-border">
          <GroupHeader group={group} />

          <WarehouseMaterialsCards materials={group.items} />
        </div>
      ))}
    </div>
  );
};

export default WarehouseMaterialsTable;
