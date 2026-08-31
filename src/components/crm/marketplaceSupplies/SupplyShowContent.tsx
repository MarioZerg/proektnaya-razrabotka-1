import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SupplyDetail, SupplyStatus } from '@/lib/marketplaceSuppliesApi';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import type { MarketplaceItem } from '@/lib/marketplaceItemsApi';
import OzonFboApplicationCard from '@/components/crm/marketplaceSupplies/OzonFboApplicationCard';
import GazelkaShippingCard from '@/components/crm/marketplaceSupplies/GazelkaShippingCard';
import SupplyHeader from '@/components/crm/marketplaceSupplies/SupplyHeader';
import SupplyFboFieldsCard from '@/components/crm/marketplaceSupplies/SupplyFboFieldsCard';
import SupplyItemsSection from '@/components/crm/marketplaceSupplies/SupplyItemsSection';
import SupplySewingSection from '@/components/crm/marketplaceSupplies/SupplySewingSection';
import CancelledScanDialog, {
  type CancelledScanInfo,
} from '@/components/crm/marketplaceSupplies/CancelledScanDialog';
import AddSewingOrdersDialog from '@/components/crm/marketplaceSupplies/AddSewingOrdersDialog';
import SupplyGroupsPanel from '@/components/crm/marketplaceSupplies/SupplyGroupsPanel';
import WbFbsSupplyCard from '@/components/crm/marketplaceSupplies/WbFbsSupplyCard';
import WbFboSupplyCard from '@/components/crm/marketplaceSupplies/WbFboSupplyCard';

interface SupplyShowContentProps {
  supply: SupplyDetail;
  supplyId: number;
  now: Date;
  readyGoods: GoodsWarehouseItem[];
  marketplaceItems: MarketplaceItem[];
  load: (silent?: boolean) => void;
  fields: {
    supplyNumber: string;
    setSupplyNumber: Dispatch<SetStateAction<string>>;
    supplyBarcode: string;
    setSupplyBarcode: Dispatch<SetStateAction<string>>;
    cluster: string;
    setCluster: Dispatch<SetStateAction<string>>;
    gazelkaId: string;
    setGazelkaId: Dispatch<SetStateAction<string>>;
    comment: string;
    setComment: Dispatch<SetStateAction<string>>;
  };
  flags: {
    isWbFbs: boolean;
    nextStatus: SupplyStatus | undefined;
    isManagerRole: boolean;
    isManager: boolean;
    canEditItems: boolean;
    canRemoveItems: boolean;
    isOzonFbo: boolean;
    isWbFbo: boolean;
    gazelkaReady: boolean;
    nextStatusLabel: Record<string, string>;
  };
  actions: {
    saving: boolean;
    ozonShipping: number;
    importingFbo: boolean;
    loadingQr: boolean;
    forceCompleting: boolean;
    addOrdersOpen: boolean;
    setAddOrdersOpen: Dispatch<SetStateAction<boolean>>;
    addingOrders: boolean;
    scanOrderNumber: string;
    setScanOrderNumber: Dispatch<SetStateAction<string>>;
    scanning: boolean;
    scanInputRef: RefObject<HTMLInputElement>;
    cancelledScan: CancelledScanInfo | null;
    setCancelledScan: Dispatch<SetStateAction<CancelledScanInfo | null>>;
    handleAddSewingOrders: (
      rows: { marketplaceItemId: number; quantity: number }[],
    ) => Promise<void>;
    handleScanOrder: () => void;
    handleRemoveItem: (itemId: number) => void;
    handleSaveFields: () => void;
    handleMoveStatus: () => void;
    handleLoadQr: () => void;
    handleForceComplete: () => void;
    handleImportFboComposition: () => void;
    handleDelete: () => void;
  };
}

/**
 * Разметка карточки поставки: шапка, блоки маркетплейсов, пошив, связки и товарный состав.
 *
 * Перенесено из страницы 1:1 — порядок блоков и условия их показа не менялись.
 */
const SupplyShowContent = ({
  supply,
  supplyId,
  now,
  readyGoods,
  marketplaceItems,
  load,
  fields,
  flags,
  actions,
}: SupplyShowContentProps) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <SupplyHeader
        supply={supply}
        isOzonFbo={flags.isOzonFbo}
        now={now}
        readOnly={flags.isManagerRole && supply.type === 'FBS'}
        nextStatus={flags.nextStatus}
        nextStatusLabel={flags.nextStatusLabel}
        saving={actions.saving}
        ozonShipping={actions.ozonShipping}
        forceCompleting={actions.forceCompleting}
        onBack={() => navigate('/crm/shipments/to-marketplace')}
        onDelete={actions.handleDelete}
        onForceComplete={actions.handleForceComplete}
        onMoveStatus={actions.handleMoveStatus}
        loadingQr={actions.loadingQr}
        onLoadQr={actions.handleLoadQr}
      />

      {flags.isOzonFbo && (
        <OzonFboApplicationCard
          supply={supply}
          onImportComposition={flags.isManager ? actions.handleImportFboComposition : undefined}
          importing={actions.importingFbo}
        />
      )}

      {flags.isWbFbo && (
        <WbFboSupplyCard supply={supply} onReload={load} isManager={flags.isManager} />
      )}

      {supply.type === 'FBO' && !flags.isOzonFbo && !flags.isWbFbo && (
        <SupplyFboFieldsCard
          supply={supply}
          supplyNumber={fields.supplyNumber}
          setSupplyNumber={fields.setSupplyNumber}
          supplyBarcode={fields.supplyBarcode}
          setSupplyBarcode={fields.setSupplyBarcode}
          cluster={fields.cluster}
          setCluster={fields.setCluster}
          gazelkaId={fields.gazelkaId}
          setGazelkaId={fields.setGazelkaId}
          comment={fields.comment}
          setComment={fields.setComment}
          saving={actions.saving}
          onSave={actions.handleSaveFields}
        />
      )}

      {(flags.isOzonFbo || flags.isWbFbo) && (
        <GazelkaShippingCard
          supply={supply}
          onReload={load}
          isManager={flags.isManager}
          gazelkaReady={flags.gazelkaReady}
        />
      )}

      {/* Пошив по поставке: менеджер видит, что уже сшито, и догружает недостающее.
          Показываем НАД товарным составом — сначала производство, потом сборка. */}
      {supply.type === 'FBO' && (
        <SupplySewingSection
          orders={supply.sewingOrders || []}
          canAdd={
            flags.isManager && supply.status !== 'Отгрузка' && supply.status !== 'Выполнена'
          }
          onAdd={() => actions.setAddOrdersOpen(true)}
        />
      )}

      {/* Связки заказов Яндекса: показываем НАД списком товаров, чтобы кладовщик увидел
          незакрытые связки сразу, а не после прокрутки всей поставки. */}
      <SupplyGroupsPanel
        groups={supply.groups || []}
        cancelledCount={supply.items.filter((i) => i.isCancelled).length}
      />

      {flags.isWbFbs ? (
        <WbFbsSupplyCard supply={supply} supplyId={supplyId} onReload={load} />
      ) : (
        <SupplyItemsSection
          supply={supply}
          supplyId={supplyId}
          canEditItems={flags.canEditItems}
          canRemoveItems={flags.canRemoveItems}
          readyGoods={readyGoods}
          scanOrderNumber={actions.scanOrderNumber}
          setScanOrderNumber={actions.setScanOrderNumber}
          scanning={actions.scanning}
          scanInputRef={actions.scanInputRef}
          onScanOrder={actions.handleScanOrder}
          onRemoveItem={actions.handleRemoveItem}
          onNavigateAssemble={() =>
            navigate(`/crm/shipments/to-marketplace/${supplyId}/assemble`)
          }
          onReload={load}
        />
      )}

      <AddSewingOrdersDialog
        open={actions.addOrdersOpen}
        onOpenChange={actions.setAddOrdersOpen}
        marketplaceItems={marketplaceItems}
        saving={actions.addingOrders}
        onCreate={actions.handleAddSewingOrders}
      />

      {/* Отсканирована вещь отменённого заказа: звук уже прозвучал, окно
          показывает, что за вещь в руках и куда её деть — на полку, не в короб. */}
      <CancelledScanDialog
        info={actions.cancelledScan}
        onClose={() => actions.setCancelledScan(null)}
      />
    </div>
  );
};

export default SupplyShowContent;
