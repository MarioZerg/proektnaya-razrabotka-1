import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { MaterialTypeGroup } from '@/components/crm/warehouseMaterials/warehouseMaterialsShared';
import {
  formatRolls,
  remainderLabel,
  stockQtyClass,
  typeTotals,
  warehouseStatus,
} from '@/components/crm/warehouseMaterials/warehouseMaterialsShared';
import WarehouseMaterialsCards from '@/components/crm/warehouseMaterials/WarehouseMaterialsCards';

interface WarehouseMaterialsTableProps {
  loading: boolean;
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

/** Склад материалов: на телефоне карточки, на широком экране компактная таблица
 *  без горизонтальной прокрутки. Количество и рулоны собраны в одну ячейку. */
const WarehouseMaterialsTable = ({
  loading,
  groups,
  filtered,
}: WarehouseMaterialsTableProps) => {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-4 py-8 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (groups.length === 0) {
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

          <div className="md:hidden p-3">
            <WarehouseMaterialsCards materials={group.items} />
          </div>

          <div className="hidden min-w-0 overflow-hidden md:block">
            <Table className="min-w-0 table-fixed">
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="w-[46%] whitespace-normal text-primary-foreground">
                    Материал
                  </TableHead>
                  <TableHead className="w-[28%] whitespace-normal text-primary-foreground">
                    Остаток
                  </TableHead>
                  <TableHead className="w-[26%] whitespace-normal text-primary-foreground">
                    Статус
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.items.map((item) => {
                  const status = warehouseStatus(item);
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-normal break-words align-top font-medium">
                        {item.name}
                      </TableCell>
                      <TableCell className="whitespace-normal align-top">
                        <div className={`tabular-nums ${stockQtyClass[status.kind]}`}>
                          {remainderLabel(item)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatRolls(item.warehouseRolls)}
                        </div>
                      </TableCell>
                      <TableCell className="align-top">
                        <Badge
                          variant={status.kind === 'empty' ? 'outline' : 'secondary'}
                          className={status.className}
                        >
                          {status.label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      ))}
    </div>
  );
};

export default WarehouseMaterialsTable;
