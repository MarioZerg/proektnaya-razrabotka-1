import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import SupplyBoxCard from '@/components/crm/marketplaceSupplies/SupplyBoxCard';

interface SupplyBoxesSectionProps {
  supply: SupplyDetail;
  canEdit: boolean;
  isOzonFbo: boolean;
  isWbFbo: boolean;
  /** Закрывать короба можно, когда есть непустые короба. */
  canCloseBoxes: boolean;
  cargoType: 'BOX' | 'PALLET';
  addingBox: boolean;
  closingBoxes: boolean;
  onCargoTypeChange: (value: 'BOX' | 'PALLET') => void;
  onCloseBoxes: () => void;
  onAddBox: () => void;
  onCloseOzonBox: (boxId: number) => Promise<void>;
  onAddOrder: (boxId: number, orderNumber: string) => Promise<void>;
  onRemoveItem: (itemId: number) => void;
  onDeleteBox: (boxId: number) => void;
  onCloseBox: (boxId: number) => Promise<void>;
}

/**
 * Короба поставки: панель управления сверху и сетка коробов под ней.
 *
 * Тип грузоместа и закрытие всех коробов разом нужны только OZON FBO — там
 * короб превращается в грузоместо на стороне площадки.
 */
const SupplyBoxesSection = ({
  supply,
  canEdit,
  isOzonFbo,
  isWbFbo,
  canCloseBoxes,
  cargoType,
  addingBox,
  closingBoxes,
  onCargoTypeChange,
  onCloseBoxes,
  onAddBox,
  onCloseOzonBox,
  onAddOrder,
  onRemoveItem,
  onDeleteBox,
  onCloseBox,
}: SupplyBoxesSectionProps) => (
  <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">Короба ({supply.boxes.length})</h2>
      <div className="flex flex-wrap items-center gap-2">
        {isOzonFbo && (
          <Select value={cargoType} onValueChange={(v) => onCargoTypeChange(v as 'BOX' | 'PALLET')}>
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="BOX">Короб</SelectItem>
              <SelectItem value="PALLET">Палета</SelectItem>
            </SelectContent>
          </Select>
        )}
        {canCloseBoxes && (
          <Button
            size="sm"
            className="bg-[#005BFF] text-white hover:bg-[#0047cc]"
            onClick={onCloseBoxes}
            disabled={closingBoxes}
          >
            <Icon
              name={closingBoxes ? 'Loader2' : 'PackageCheck'}
              size={14}
              className={`mr-1 ${closingBoxes ? 'animate-spin' : ''}`}
            />
            Закрыть короба и получить стикеры
          </Button>
        )}
        {canEdit && (
          <Button size="sm" onClick={onAddBox} disabled={addingBox}>
            {addingBox ? (
              <Icon name="Loader2" size={14} className="mr-1 animate-spin" />
            ) : (
              <Icon name="PackagePlus" size={14} className="mr-1" />
            )}
            Добавить короб
          </Button>
        )}
      </div>
    </div>

    {supply.boxes.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        Коробов пока нет — нажмите «Добавить короб», чтобы начать сборку
      </p>
    ) : (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {supply.boxes.map((box) => (
          <SupplyBoxCard
            key={box.id}
            box={box}
            supply={supply}
            canEdit={canEdit}
            isWbFbo={isWbFbo}
            isOzonFbo={isOzonFbo}
            onCloseOzonBox={onCloseOzonBox}
            onAddOrder={onAddOrder}
            onRemoveItem={onRemoveItem}
            onDeleteBox={onDeleteBox}
            onCloseBox={onCloseBox}
          />
        ))}
      </div>
    )}
  </div>
);

export default SupplyBoxesSection;
