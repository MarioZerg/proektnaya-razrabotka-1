import MoveShelfDialog from '@/components/crm/goodsWarehouse/MoveShelfDialog';
import PlaceOnShelfDialog from '@/components/crm/goodsWarehouse/PlaceOnShelfDialog';
import PickupReturnsDialog from '@/components/crm/returns/PickupReturnsDialog';
import PlaceInspectedDialog from '@/components/crm/goodsWarehouse/PlaceInspectedDialog';
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
    <PlaceOnShelfDialog
      open={placeOpen}
      onOpenChange={setPlaceOpen}
      shelves={shelves}
      pendingItems={pendingShelf}
      onDone={load}
    />
    <PickupReturnsDialog
      open={pickupOpen}
      onOpenChange={setPickupOpen}
      onDone={load}
    />
    {/* Третий шаг цепочки возвратов: вещи, которые уехали в цех на осмотр,
        вернулись проверенными — кладовщик сканирует их и кладёт на полки,
        не уходя со склада товара. */}
    <PlaceInspectedDialog
      open={placeInspectedOpen}
      onOpenChange={setPlaceInspectedOpen}
      onDone={() => {
        load();
        loadInspectedReady();
      }}
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
