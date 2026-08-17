import MoveShelfDialog from '@/components/crm/goodsWarehouse/MoveShelfDialog';
import PlaceOnShelfDialog from '@/components/crm/goodsWarehouse/PlaceOnShelfDialog';
import PickupReturnsDialog from '@/components/crm/returns/PickupReturnsDialog';
import ReprintReportDialog from '@/components/crm/goodsWarehouse/ReprintReportDialog';
import AdminReceiveDialog from '@/components/crm/goodsWarehouse/AdminReceiveDialog';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import type { Shelf } from '@/lib/shelvesApi';

interface GoodsWarehouseDialogsProps {
  isAdmin: boolean;
  canReceiveManually: boolean;
  shelves: Shelf[];
  /** Отказы из цеха, которые кладовщик раскладывает по полкам сканером. */
  pendingShelf: GoodsWarehouseItem[];
  placeOpen: boolean;
  setPlaceOpen: (open: boolean) => void;
  pickupOpen: boolean;
  setPickupOpen: (open: boolean) => void;
  /** Осмотренные из цеха — вторая вкладка внутри «Разложить по полкам». */
  placeInspectedOpen: boolean;
  setPlaceInspectedOpen: (open: boolean) => void;
  /** Сколько осмотренных вещей ждут укладки. */
  inspectedReady?: number;
  moveOpen: boolean;
  setMoveOpen: (open: boolean) => void;
  adminReceiveOpen: boolean;
  setAdminReceiveOpen: (open: boolean) => void;
  reprintOpen: boolean;
  setReprintOpen: (open: boolean) => void;
  /** Перечитать склад после любого действия. */
  load: () => void;
  /** Пересчитать плитку «Принять осмотренные из цеха». */
  loadInspectedReady: () => void;
}

/** Все окна склада товара в одном месте — страница остаётся читаемой. */
const GoodsWarehouseDialogs = ({
  isAdmin,
  canReceiveManually,
  shelves,
  pendingShelf,
  placeOpen,
  setPlaceOpen,
  pickupOpen,
  setPickupOpen,
  placeInspectedOpen,
  setPlaceInspectedOpen,
  moveOpen,
  setMoveOpen,
  adminReceiveOpen,
  setAdminReceiveOpen,
  reprintOpen,
  setReprintOpen,
  inspectedReady = 0,
  load,
  loadInspectedReady,
}: GoodsWarehouseDialogsProps) => (
  <>
    {/* Одно окно на оба дела кладовщика у стеллажа: отменённые клиентом вещи и
        осмотренные, вернувшиеся из цеха. Вторые — вкладкой внутри. */}
    <PlaceOnShelfDialog
      open={placeOpen || placeInspectedOpen}
      onOpenChange={(v) => {
        setPlaceOpen(v);
        if (!v) setPlaceInspectedOpen(false);
      }}
      shelves={shelves}
      pendingItems={pendingShelf}
      onDone={load}
      inspectedReady={inspectedReady}
      onInspectedDone={loadInspectedReady}
      initialTab={placeInspectedOpen ? 'inspected' : 'cancelled'}
    />
    <PickupReturnsDialog
      open={pickupOpen}
      onOpenChange={setPickupOpen}
      onDone={load}
    />
    <MoveShelfDialog
      open={moveOpen}
      onOpenChange={setMoveOpen}
      shelves={shelves}
      onDone={load}
    />
    {canReceiveManually && (
      <AdminReceiveDialog
        open={adminReceiveOpen}
        onOpenChange={setAdminReceiveOpen}
        shelves={shelves}
        onDone={load}
      />
    )}
    {isAdmin && (
      <ReprintReportDialog open={reprintOpen} onOpenChange={setReprintOpen} />
    )}
  </>
);

export default GoodsWarehouseDialogs;
