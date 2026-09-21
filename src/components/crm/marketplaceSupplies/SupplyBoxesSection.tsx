import { useState } from 'react';
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
  onSetItemCount: (boxId: number, itemIds: number[], removeCount: number) => void;
  onDeleteBox: (boxId: number) => void;
  onCloseBox: (boxId: number) => Promise<void>;
}

/**
 * Короба поставки: панель управления сверху и плашки коробов под ней.
 *
 * ОТКРЫТ ВСЕГДА РОВНО ОДИН КОРОБ. Кладовщик физически набивает один короб за
 * раз — значит и поле сканера должно быть одно. Раньше короба висели
 * развёрнутыми в три колонки, у каждого своё поле: на большой поставке экран
 * превращался в простыню, и вещь улетала в короб, который в этот момент не
 * виден. Теперь раскрытие одного само закрывает предыдущий.
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
  onSetItemCount,
  onDeleteBox,
  onCloseBox,
}: SupplyBoxesSectionProps) => {
  // ВСЕ КОРОБА ЗАКРЫТЫ, ПОКА КЛАДОВЩИК САМ НЕ ОТКРОЕТ НУЖНЫЙ.
  //
  // Раньше экран сам раскрывал последний незакрытый короб — «чтобы сразу
  // пикать». Но сканер стреляет в то поле, где стоит курсор, и кладовщик,
  // зайдя на экран с вещью в руках, отправлял её в короб, который открылся
  // САМ, а не который он выбрал. Товар уезжал не туда, а заметно это только
  // при закрытии короба.
  //
  // Выбор короба — осознанное действие: сначала открыл нужный, потом пикаешь.
  const [openBoxId, setOpenBoxId] = useState<number | null>(null);

  const closedCount = supply.boxes.filter((b) => b.closedAt).length;
  const totalItems = supply.boxes.reduce((sum, b) => sum + b.items.length, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Короба ({supply.boxes.length})</h2>
          {supply.boxes.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Уложено вещей: <b>{totalItems}</b>
              {closedCount > 0 && ` · закрыто коробов: ${closedCount} из ${supply.boxes.length}`}
            </p>
          )}
        </div>
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
        // Плашки идут в столбик, а не в сетку: раскрытый короб со списком
        // вещей в колонке шириной в треть экрана нечитаем.
        <div className="space-y-2">
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
              onSetItemCount={onSetItemCount}
              onDeleteBox={onDeleteBox}
              onCloseBox={onCloseBox}
              open={openBoxId === box.id}
              onOpenChange={(next) => setOpenBoxId(next ? box.id : null)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default SupplyBoxesSection;