import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SupplyDetail, SupplyStatus, WbSupplyOrder } from '@/lib/marketplaceSuppliesApi';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import type { MarketplaceItem, Shop } from '@/lib/marketplaceItemsApi';
import SupplyHeader from '@/components/crm/marketplaceSupplies/SupplyHeader';
import SupplyItemsSection from '@/components/crm/marketplaceSupplies/SupplyItemsSection';
import CancelledScanDialog, {
  type CancelledScanInfo,
} from '@/components/crm/marketplaceSupplies/CancelledScanDialog';
import AddSewingOrdersDialog from '@/components/crm/marketplaceSupplies/AddSewingOrdersDialog';
import SupplyGroupsPanel from '@/components/crm/marketplaceSupplies/SupplyGroupsPanel';
import WbFbsSupplyCard from '@/components/crm/marketplaceSupplies/WbFbsSupplyCard';
import SupplyAcceptanceCard from '@/components/crm/marketplaceSupplies/SupplyAcceptanceCard';
import FboSupplyStages from '@/components/crm/marketplaceSupplies/FboSupplyStages';

export interface SupplyShowContentProps {
  supply: SupplyDetail;
  supplyId: number;
  now: Date;
  readyGoods: GoodsWarehouseItem[];
  marketplaceItems: MarketplaceItem[];
  shops?: Shop[];
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
    nextStatusShort: Record<string, string>;
  };
  actions: {
    saving: boolean;
    ozonShipping: number;
    importingFbo: boolean;
    loadingQr: boolean;
    forceCompleting: boolean;
    addOrdersOpen: boolean;
    setAddOrdersOpen: Dispatch<SetStateAction<boolean>>;
    /** Убрать товар из состава поставки: только «Новый» и «Со склада». */
    handleRemoveSewingOrder: (order: { id: number; orderNumber: string }) => void;
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
    handleWbScanned: (order: WbSupplyOrder, supplyStatus?: string) => void;
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
 * Разметка карточки поставки.
 *
 * FBO идёт по шагам: заявка, пошив, сборка, отгрузка — у менеджера и кладовщика
 * свой текущий шаг. FBS остаётся одной лентой: там работа короче и вся на складе.
 */
const SupplyShowContent = ({
  supply,
  supplyId,
  now,
  readyGoods,
  marketplaceItems,
  shops = [],
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
        nextStatusShort={flags.nextStatusShort}
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

      {supply.type === 'FBO' ? (
        <FboSupplyStages
          supply={supply}
          supplyId={supplyId}
          now={now}
          readyGoods={readyGoods}
          load={load}
          fields={fields}
          flags={flags}
          actions={actions}
          onNavigateAssemble={() =>
            navigate(`/crm/shipments/to-marketplace/${supplyId}/assemble`)
          }
        />
      ) : (
        <>
          {/* Итог после отгрузки FBS: всё отсканировано или есть недостача. */}
          <SupplyAcceptanceCard
            supply={supply}
            now={now}
            isManager={flags.isManager}
            onReload={() => load(true)}
          />

          {/* Связки заказов Яндекса: показываем НАД списком товаров, чтобы кладовщик увидел
              незакрытые связки сразу, а не после прокрутки всей поставки. */}
          <SupplyGroupsPanel
            groups={supply.groups || []}
            cancelledCount={supply.items.filter((i) => i.isCancelled).length}
          />
        </>
      )}

      {supply.type !== 'FBO' &&
        (flags.isWbFbs ? (
          <WbFbsSupplyCard
            supply={supply}
            supplyId={supplyId}
            onReload={load}
            onScanned={actions.handleWbScanned}
          />
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
        ))}

      <AddSewingOrdersDialog
        open={actions.addOrdersOpen}
        onOpenChange={actions.setAddOrdersOpen}
        marketplaceItems={marketplaceItems}
        shops={shops}
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