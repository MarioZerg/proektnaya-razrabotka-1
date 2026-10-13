import { Fragment, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import MaterialSupplies from '@/components/crm/warehouseMaterials/MaterialSupplies';
import type { Material } from '@/lib/materialsApi';
import {
  formatRolls,
  remainderLabel,
  stockQtyClass,
  warehouseStatus,
} from '@/components/crm/warehouseMaterials/warehouseMaterialsShared';

interface WarehouseMaterialsCardsProps {
  materials: Material[];
}

/**
 * Телефон: те же три колонки, что в таблице склада, только сеткой на ширину экрана.
 * Таблица с min-w-max здесь уезжала вбок, и остаток приходилось искать прокруткой.
 */
const WarehouseMaterialsCards = ({ materials }: WarehouseMaterialsCardsProps) => {
  const [openId, setOpenId] = useState<number | null>(null);
  return (
  <div>
    <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1fr)] bg-primary text-[11px] text-primary-foreground">
      <div className="px-3 py-2">Материал</div>
      <div className="px-2 py-2 text-right">Остаток</div>
      <div className="px-2 py-2">Статус</div>
    </div>
    <div className="divide-y divide-border">
      {materials.map((item) => {
        const status = warehouseStatus(item);
        const open = openId === item.id;
        return (
          <Fragment key={item.id}>
          <button
            type="button"
            onClick={() => setOpenId(open ? null : item.id)}
            className="grid w-full grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1fr)] items-start text-left hover:bg-muted/40"
          >
            <div className="flex min-w-0 items-start gap-1.5 break-words px-3 py-2.5 text-sm font-medium leading-snug">
              <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                {item.name}
                <span className="block text-[11px] font-normal text-muted-foreground">Поставки</span>
              </span>
            </div>
            <div className="px-2 py-2.5 text-right">
              <div className={`text-sm tabular-nums leading-none ${stockQtyClass[status.kind]}`}>
                {remainderLabel(item)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {formatRolls(item.warehouseRolls)}
              </div>
            </div>
            <div className="px-2 py-2.5">
              <Badge
                variant={status.kind === 'empty' ? 'outline' : 'secondary'}
                className={`h-auto max-w-full whitespace-normal px-1.5 py-0.5 text-center text-[11px] leading-tight ${status.className}`}
              >
                {status.label}
              </Badge>
            </div>
          </button>
          {open && <MaterialSupplies materialId={item.id} unit={item.unit} />}
          </Fragment>
        );
      })}
    </div>
  </div>
  );
};

export default WarehouseMaterialsCards;
