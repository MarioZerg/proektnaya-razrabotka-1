import type { Dispatch, SetStateAction } from 'react';
import EditOrderDialog from '@/components/crm/orders/EditOrderDialog';
import CreateManualOrderDialog from '@/components/crm/orders/CreateManualOrderDialog';
import PullOrderByNumberDialog from '@/components/crm/orders/PullOrderByNumberDialog';
import BulkCancelDialog from '@/components/crm/orders/BulkCancelDialog';
import type { EditFormState, ManualOrderRow } from '@/components/crm/orders/ordersShared';
import type { MarketplaceFilter } from '@/components/crm/orders/OrdersToolbar';
import type { MarketplaceItem, Shop } from '@/lib/marketplaceItemsApi';
import type { Order } from '@/lib/ordersApi';

/**
 * Нижняя группа диалогов страницы заказов: правка, ручное создание,
 * догрузка по номеру и массовая отмена. Пропсы 1:1 из MarketplaceOrders.
 */
interface Props {
  editingOrder: Order | null;
  form: EditFormState | null;
  setForm: Dispatch<SetStateAction<EditFormState | null>>;
  saving: boolean;
  onCloseEdit: () => void;
  onSave: () => void;
  manualOpen: boolean;
  setManualOpen: Dispatch<SetStateAction<boolean>>;
  manualRows: ManualOrderRow[];
  setManualRows: Dispatch<SetStateAction<ManualOrderRow[]>>;
  marketplaceItems: MarketplaceItem[];
  shops: Shop[];
  manualSaving: boolean;
  onManualCreate: () => void;
  pullOpen: boolean;
  setPullOpen: Dispatch<SetStateAction<boolean>>;
  bulkCancelOpen: boolean;
  onBulkCancelClose: () => void;
  materialFilter: string;
  marketplaceFilter: MarketplaceFilter;
  load: () => void;
}

const OrdersPageDialogs = ({
  editingOrder,
  form,
  setForm,
  saving,
  onCloseEdit,
  onSave,
  manualOpen,
  setManualOpen,
  manualRows,
  setManualRows,
  marketplaceItems,
  shops,
  manualSaving,
  onManualCreate,
  pullOpen,
  setPullOpen,
  bulkCancelOpen,
  onBulkCancelClose,
  materialFilter,
  marketplaceFilter,
  load,
}: Props) => (
  <>
    <EditOrderDialog
      editingOrder={editingOrder}
      form={form}
      setForm={setForm}
      saving={saving}
      onClose={onCloseEdit}
      onSave={onSave}
    />

    <CreateManualOrderDialog
      open={manualOpen}
      onOpenChange={setManualOpen}
      rows={manualRows}
      setRows={setManualRows}
      marketplaceItems={marketplaceItems}
      shops={shops}
      manualSaving={manualSaving}
      onCreate={onManualCreate}
    />

    <PullOrderByNumberDialog
      open={pullOpen}
      onOpenChange={setPullOpen}
      onDone={load}
    />

    <BulkCancelDialog
      open={bulkCancelOpen}
      material={materialFilter === 'all' ? '' : materialFilter}
      marketplace={marketplaceFilter}
      onClose={onBulkCancelClose}
      onDone={load}
    />
  </>
);

export default OrdersPageDialogs;
