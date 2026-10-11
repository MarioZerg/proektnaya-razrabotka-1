import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import GoodsWarehouseCards from '@/components/crm/goodsWarehouse/GoodsWarehouseCards';
import GoodsWarehouseTableDialogs from '@/components/crm/goodsWarehouse/GoodsWarehouseTableDialogs';
import { useGoodsWarehouseTableActions } from '@/components/crm/goodsWarehouse/useGoodsWarehouseTableActions';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';

interface GoodsWarehouseTableProps {
  loading: boolean;
  /** FRONTEND-ONLY: сбой GET списка — не путать с «товаров не найдено». */
  error?: string | null;
  items: GoodsWarehouseItem[];
  onReturnToWorkshop: (id: number) => void;
  onMarkLost: (id: number, reason: string) => Promise<void>;
  /** Колонка «Действия» видна только администратору. */
  isAdmin?: boolean;
  /** Удаление со склада — только для вещей на хранении и только у администратора. */
  onDelete?: (id: number) => Promise<void>;
  /**
   * ОТБОР МЕНЕДЖЕРА в поставку. Это отдельная колонка галочек, не связанная с
   * печатью стикеров: кладовщик отмечает вещи, чтобы напечатать ленту наклеек,
   * менеджер — чтобы выгрузить их в Excel и забрать со склада. Роли не
   * пересекаются, поэтому в один момент видна только одна колонка.
   */
  pickMode?: boolean;
  pickedIds?: number[];
  onTogglePick?: (id: number) => void;
  onToggleAllPicked?: () => void;
  allPicked?: boolean;
}

const GoodsWarehouseTable = ({
  loading,
  error = null,
  items,
  onReturnToWorkshop,
  onMarkLost,
  isAdmin = false,
  onDelete,
  pickMode = false,
  pickedIds = [],
  onTogglePick,
}: GoodsWarehouseTableProps) => {
  const a = useGoodsWarehouseTableActions({ items, onMarkLost, onDelete });

  if (loading && items.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (items.length === 0) {
    // Баннер ошибки уже над таблицей — здесь не дублируем и не пишем «не найдено».
    if (error) return null;
    return <p className="text-sm text-muted-foreground">Товаров не найдено</p>;
  }

  return (
    <>
      <div>
        <GoodsWarehouseCards
          items={items}
          onReturnToWorkshop={onReturnToWorkshop}
          onMarkLost={a.openLostDialog}
          onPrintMpLabel={a.handlePrintMpLabel}
          pickMode={pickMode}
          pickedIds={pickedIds}
          onTogglePick={onTogglePick}
          canSelectStickers={a.canPrintStickers}
          selectedIds={a.selectedIds}
          onToggleSelect={a.toggleOne}
          isAdmin={isAdmin}
          onRequestDelete={a.setDeleteId}
        />
      </div>

      {a.canPrintStickers && a.selectedItems.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary bg-primary/5 px-3 py-2">
          <div className="text-sm font-medium">Выбрано: {a.selectedItems.length} шт.</div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => a.setSelectedIds([])}>
              Снять выделение
            </Button>
            <Button size="sm" onClick={a.handlePrintSelected}>
              <Icon name="Printer" size={14} className="mr-1.5" />
              Напечатать ленту стикеров
            </Button>
          </div>
        </div>
      )}

      <GoodsWarehouseTableDialogs
        lostId={a.lostId}
        setLostId={a.setLostId}
        lostReason={a.lostReason}
        setLostReason={a.setLostReason}
        saving={a.saving}
        onConfirmLost={a.handleConfirmLost}
        deleteId={a.deleteId}
        setDeleteId={a.setDeleteId}
        deleting={a.deleting}
        onConfirmDelete={a.handleConfirmDelete}
      />
    </>
  );
};

export default GoodsWarehouseTable;
