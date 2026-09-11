import { useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import CancelledScanDialog from '@/components/crm/marketplaceSupplies/CancelledScanDialog';
import SupplyCandidatesPanel from '@/components/crm/marketplaceSupplies/SupplyCandidatesPanel';
import PassStickerCard from '@/components/crm/marketplaceSupplies/PassStickerCard';
import SupplyAssembleHeader from '@/components/crm/marketplaceSupplies/SupplyAssembleHeader';
import SupplyBoxesSection from '@/components/crm/marketplaceSupplies/SupplyBoxesSection';
import SupplyAssembleFooter from '@/components/crm/marketplaceSupplies/SupplyAssembleFooter';
import SupplyLockedScreen from '@/components/crm/marketplaceSupplies/SupplyLockedScreen';
import { useSupplyAssemble } from '@/components/crm/marketplaceSupplies/useSupplyAssemble';

/**
 * Экран сборки поставки: кладовщик раскладывает вещи по коробам.
 *
 * Вся работа с данными вынесена в хук useSupplyAssemble, разметка — в четыре
 * компонента рядом. Здесь остались только состояния экрана (загрузка, занятая
 * поставка, рабочий вид) и расчёты, которыми эти части связаны.
 */
const MarketplaceSupplyAssemble = () => {
  const { id } = useParams();
  const supplyId = Number(id);

  const {
    navigate,
    supply,
    loading,
    addingBox,
    completing,
    candidatesOpen,
    setCandidatesOpen,
    candidates,
    candidatesLoading,
    closingBoxes,
    cargoType,
    lockedByOther,
    cancelledScan,
    setCancelledScan,
    handleAddBox,
    handleDeleteBox,
    handleAddOrderToBox,
    handleCloseBox,
    handleRemoveItem,
    handleCargoTypeChange,
    handleSupplyAssembled,
    handleCloseOzonBox,
    handleCloseBoxes,
    handleUploadSticker,
  } = useSupplyAssemble(supplyId);

  if (loading || !supply) {
    return (
      <CrmLayout>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка...
        </div>
      </CrmLayout>
    );
  }

  // Поставку уже собирает другой кладовщик — вместо рабочего экрана показываем
  // предупреждение. Так двое не разложат заказы по чужим коробам.
  if (lockedByOther) {
    return (
      <CrmLayout>
        <SupplyLockedScreen
          reason={lockedByOther}
          onBackToList={() => navigate('/crm/shipments/to-marketplace')}
        />
      </CrmLayout>
    );
  }

  const canEdit = supply.status === 'Открытая' || supply.status === 'На сборке';
  const totalBoxedItems = supply.boxes.reduce((sum, b) => sum + b.items.length, 0);
  // Сколько ещё вещей нужно уложить в короба по заявке маркетплейса.
  const remainingToScan =
    supply.totalQuantityMarketplace != null
      ? Math.max(0, supply.totalQuantityMarketplace - totalBoxedItems)
      : 0;
  const isOzonFbo = supply.marketplace === 'OZON' && supply.type === 'FBO';
  const isWbFbo = supply.marketplace === 'WB' && supply.type === 'FBO';
  // Закрывать короба можно, когда есть непустые короба (у OZON FBO это создаёт грузоместа на OZON).
  const canCloseBoxes = isOzonFbo && totalBoxedItems > 0;
  // Непустые короба, которые ещё не заклеены: пока такие есть, поставку
  // закрывать рано — их состав ещё может измениться.
  const openBoxes = supply.boxes.filter(
    (b) => b.items.length > 0 && !b.closedAt,
  ).length;

  return (
    <CrmLayout>
      <div className="space-y-6">
        <SupplyAssembleHeader
          supply={supply}
          totalBoxedItems={totalBoxedItems}
          remainingToScan={remainingToScan}
          onBack={() => navigate(`/crm/shipments/to-marketplace/${supplyId}`)}
        />

        {supply.marketplace === 'WB' && (
          <PassStickerCard
            passStickerUrl={supply.passStickerUrl}
            passStickerName={supply.passStickerName}
            saving={!canEdit}
            onUpload={handleUploadSticker}
          />
        )}

        <SupplyCandidatesPanel
          open={candidatesOpen}
          onOpenChange={setCandidatesOpen}
          candidates={candidates}
          loading={candidatesLoading}
        />

        <SupplyBoxesSection
          supply={supply}
          canEdit={canEdit}
          isOzonFbo={isOzonFbo}
          isWbFbo={isWbFbo}
          canCloseBoxes={canCloseBoxes}
          cargoType={cargoType}
          addingBox={addingBox}
          closingBoxes={closingBoxes}
          onCargoTypeChange={handleCargoTypeChange}
          onCloseBoxes={handleCloseBoxes}
          onAddBox={handleAddBox}
          onCloseOzonBox={handleCloseOzonBox}
          onAddOrder={handleAddOrderToBox}
          onRemoveItem={handleRemoveItem}
          onDeleteBox={handleDeleteBox}
          onCloseBox={handleCloseBox}
        />

        {/* ПОСТАВКА СОБРАНА — последний шаг кладовщика.
            Появляется, когда все короба заклеены: дальше поставка уходит в
            отгрузку, и вещи в неё уже не добавляют. Раньше кладовщик закрывал
            короба и не понимал, что делать дальше — статус приходилось менять
            менеджеру из списка поставок. */}
        {canEdit && supply.boxes.length > 0 && (
          <SupplyAssembleFooter
            openBoxes={openBoxes}
            totalBoxedItems={totalBoxedItems}
            completing={completing}
            onSupplyAssembled={handleSupplyAssembled}
          />
        )}
      </div>

      {/* Отсканирована вещь отменённого заказа: показываем, что с ней делать.
          Без этого окна она уехала бы в коробе на площадку. */}
      <CancelledScanDialog info={cancelledScan} onClose={() => setCancelledScan(null)} />
    </CrmLayout>
  );
};

export default MarketplaceSupplyAssemble;
