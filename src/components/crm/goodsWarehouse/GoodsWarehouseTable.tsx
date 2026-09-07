import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import GoodsWarehouseCards from '@/components/crm/goodsWarehouse/GoodsWarehouseCards';
import GoodsWarehouseTableRow from '@/components/crm/goodsWarehouse/GoodsWarehouseTableRow';
import GoodsWarehouseTableDialogs from '@/components/crm/goodsWarehouse/GoodsWarehouseTableDialogs';
import { useGoodsWarehouseTableActions } from '@/components/crm/goodsWarehouse/useGoodsWarehouseTableActions';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { Checkbox } from '@/components/ui/checkbox';

interface GoodsWarehouseTableProps {
  loading: boolean;
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
  items,
  onReturnToWorkshop,
  onMarkLost,
  isAdmin = false,
  onDelete,
  pickMode = false,
  pickedIds = [],
  onTogglePick,
  onToggleAllPicked,
  allPicked = false,
}: GoodsWarehouseTableProps) => {
  const a = useGoodsWarehouseTableActions({ items, onMarkLost, onDelete });

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Товаров не найдено</p>;
  }

  return (
    <>
      {/* На телефоне — карточки, на компьютере привычная таблица. */}
      <div className="md:hidden">
        <GoodsWarehouseCards
          items={items}
          onReturnToWorkshop={onReturnToWorkshop}
          onMarkLost={a.openLostDialog}
          onPrintMpLabel={a.handlePrintMpLabel}
          pickMode={pickMode}
          pickedIds={pickedIds}
          onTogglePick={onTogglePick}
        />
      </div>

      {/* Панель выбора: видна, как только отмечена хотя бы одна вещь. Кладовщик
          набирает пачку, проверяет её глазами и печатает одним заданием — вместо
          того чтобы допечатывать наклейки поштучно и потом искать в них ошибку. */}
      {a.canPrintStickers && a.selectedItems.length > 0 && (
        <div className="mb-3 hidden items-center justify-between gap-3 rounded-md border border-primary bg-primary/5 px-3 py-2 md:flex">
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

      <div className="hidden rounded-md border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              {/* Галочка отбора менеджера. В шапке — «отметить всё, что сейчас
                  показывает фильтр»: он открыл нужный размер и берёт его целиком. */}
              {pickMode && (
                <TableHead className="w-10 text-primary-foreground">
                  <Checkbox
                    checked={allPicked}
                    onCheckedChange={() => onToggleAllPicked?.()}
                    aria-label="Отметить все показанные"
                    className="border-primary-foreground data-[state=checked]:bg-primary-foreground data-[state=checked]:text-primary"
                  />
                </TableHead>
              )}
              {a.canPrintStickers && (
                <TableHead className="w-10 text-primary-foreground">
                  <Checkbox
                    checked={a.allSelected}
                    onCheckedChange={a.toggleAll}
                    aria-label="Выбрать все"
                    className="border-primary-foreground data-[state=checked]:bg-primary-foreground data-[state=checked]:text-primary"
                  />
                </TableHead>
              )}
              <TableHead className="text-primary-foreground">Товар</TableHead>
              <TableHead className="text-primary-foreground">Статус</TableHead>
              <TableHead className="text-primary-foreground">Стикеры</TableHead>
              <TableHead className="text-primary-foreground">№ полки</TableHead>
              <TableHead className="text-primary-foreground">Дата отгрузки</TableHead>
              <TableHead className="text-primary-foreground">Дата возврата</TableHead>
              {isAdmin && <TableHead className="text-primary-foreground">Действия</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Товары, принятые администратором вручную, подсвечены: их не было в заказах
                маркетплейса, по ним может понадобиться отдельная сверка. */}
            {items.map((i) => (
              <GoodsWarehouseTableRow
                key={i.id}
                i={i}
                isAdmin={isAdmin}
                onDelete={onDelete}
                pickMode={pickMode}
                pickedIds={pickedIds}
                onTogglePick={onTogglePick}
                canPrintStickers={a.canPrintStickers}
                canPrintShelfSticker={a.canPrintShelfSticker}
                canPrintMpLabels={a.canPrintMpLabels}
                selectedIds={a.selectedIds}
                toggleOne={a.toggleOne}
                labelBusyId={a.labelBusyId}
                onPrintMpLabel={a.handlePrintMpLabel}
                onRequestDelete={a.setDeleteId}
              />
            ))}
          </TableBody>
        </Table>
      </div>

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
