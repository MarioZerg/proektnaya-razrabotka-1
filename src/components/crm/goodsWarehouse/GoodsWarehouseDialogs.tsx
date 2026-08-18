import MoveShelfDialog from '@/components/crm/goodsWarehouse/MoveShelfDialog';
import PlaceOnShelfDialog from '@/components/crm/goodsWarehouse/PlaceOnShelfDialog';
import PlaceInspectedDialog from '@/components/crm/goodsWarehouse/PlaceInspectedDialog';
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
  /** Приём осмотренных из цеха — отдельное окно со своей плиткой. */
  placeInspectedOpen: boolean;
  setPlaceInspectedOpen: (open: boolean) => void;
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
  load,
  loadInspectedReady,
}: GoodsWarehouseDialogsProps) => (
  <>
    {/* Два раздельных окна: отказы клиентов с конвейера и осмотренные из цеха.
        Раньше это были вкладки в одном окне, и кладовщик путался, где что. */}
    <PlaceOnShelfDialog
      open={placeOpen}
      onOpenChange={setPlaceOpen}
      pendingItems={pendingShelf}
      onDone={load}
    />
    <PlaceInspectedDialog
      open={placeInspectedOpen}
      onOpenChange={setPlaceInspectedOpen}
      onDone={loadInspectedReady}
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
