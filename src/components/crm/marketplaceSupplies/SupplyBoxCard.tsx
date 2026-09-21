import {
  Collapsible,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import type { SupplyBox, SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import SupplyBoxCardHeader from '@/components/crm/marketplaceSupplies/SupplyBoxCardHeader';
import SupplyBoxContents from '@/components/crm/marketplaceSupplies/SupplyBoxContents';
import SupplyBoxActions from '@/components/crm/marketplaceSupplies/SupplyBoxActions';
import { useSupplyBoxCard } from '@/components/crm/marketplaceSupplies/useSupplyBoxCard';

interface SupplyBoxCardProps {
  box: SupplyBox;
  supply: SupplyDetail;
  canEdit: boolean;
  /** WB FBO: закрыть короб в нашей системе и напечатать стикер WB. */
  isWbFbo: boolean;
  /** OZON FBO: закрыть короб — создаётся грузоместо на OZON и тянется этикетка. */
  isOzonFbo?: boolean;
  /** Закрыть ОДИН короб OZON и подтянуть его стикер. */
  onCloseOzonBox?: (boxId: number) => Promise<void>;
  onAddOrder: (boxId: number, orderNumber: string) => Promise<void>;
  onRemoveItem: (itemId: number) => void;
  /** Убрать сразу несколько штук одинакового товара из короба. */
  onSetItemCount: (boxId: number, itemIds: number[], removeCount: number) => void;
  /** Вернуть закрытый короб в работу, чтобы поправить состав. */
  onReopenBox: (boxId: number) => void;
  /** Перечитать поставку после того, как этикетка получена. */
  onLabelFetched: () => void;
  onDeleteBox: (boxId: number) => void;
  onCloseBox: (boxId: number) => Promise<void>;
  /** Раскрыт ли короб. Открытым держим ровно один — тот, что набивают сейчас. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Короб поставки — свёрнутая плашка, которая раскрывается по клику.
 *
 * ПОЧЕМУ ПЛАШКА, А НЕ ОТКРЫТАЯ КАРТОЧКА. Раньше все короба висели развёрнутыми
 * в три колонки: у каждого своё поле сканера и полный список вещей. На поставке
 * в полсотни позиций экран превращался в простыню, и кладовщик пикал вещь в поле
 * короба, который в этот момент не видел — товар уезжал в соседний.
 *
 * Теперь открыт РОВНО ОДИН короб — тот, который кладовщик сейчас набивает. Поле
 * сканера есть только у него, промахнуться некуда. Свёрнутые показывают
 * количество и статус: этого хватает, чтобы понять картину, не раскрывая.
 *
 * Сам файл — сборка из трёх частей: шапка-плашка, начинка (сканер и список) и
 * блок действий. Поведение живёт в useSupplyBoxCard.
 */
const SupplyBoxCard = ({
  box,
  supply,
  canEdit,
  isWbFbo,
  isOzonFbo = false,
  onCloseOzonBox,
  onAddOrder,
  onRemoveItem,
  onSetItemCount,
  onReopenBox,
  onLabelFetched,
  onDeleteBox,
  onCloseBox,
  open,
  onOpenChange,
}: SupplyBoxCardProps) => {
  const {
    orderNumber,
    setOrderNumber,
    scanning,
    closing,
    printing,
    fetchingLabel,
    inputRef,
    canScan,
    groupedItems,
    handleCloseOzon,
    handleCloseAndPrint,
    handleAdd,
    handleFetchLabel,
    handlePrintSticker,
    handlePrintWbSticker,
  } = useSupplyBoxCard({
    box,
    supply,
    canEdit,
    open,
    onCloseOzonBox,
    onAddOrder,
    onLabelFetched,
    onCloseBox,
  });

  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className={`rounded-lg border ${
        open ? 'border-primary shadow-sm' : 'border-border'
      }`}
    >
      {/* Печать стикера вынесена в саму полосу короба: кладовщик печатает
          его с заклеенным коробом в руках, и раскрывать состав ради одной
          кнопки внизу списка не должен. Обработчики те же, что у кнопок
          внутри, — результат нажатия не зависит от того, откуда нажали. */}
      <SupplyBoxCardHeader
        box={box}
        isOzonFbo={isOzonFbo}
        isWbFbo={isWbFbo}
        open={open}
        canScan={canScan}
        printing={printing}
        onPrintSticker={handlePrintSticker}
        onPrintWbSticker={handlePrintWbSticker}
        fetchingLabel={fetchingLabel}
        onFetchLabel={handleFetchLabel}
      />

      <CollapsibleContent>
        <div className="space-y-3 border-t border-border p-4">
          <SupplyBoxContents
            box={box}
            canEdit={canEdit}
            canScan={canScan}
            isOzonFbo={isOzonFbo}
            orderNumber={orderNumber}
            setOrderNumber={setOrderNumber}
            scanning={scanning}
            inputRef={inputRef}
            onSubmitScan={handleAdd}
            groupedItems={groupedItems}
            onRemoveItem={onRemoveItem}
            onSetItemCount={onSetItemCount}
          />

          <SupplyBoxActions
            box={box}
            canEdit={canEdit}
            isWbFbo={isWbFbo}
            isOzonFbo={isOzonFbo}
            closing={closing}
            printing={printing}
            fetchingLabel={fetchingLabel}
            onCloseOzon={handleCloseOzon}
            onCloseAndPrint={handleCloseAndPrint}
            onFetchLabel={handleFetchLabel}
            onPrintSticker={handlePrintSticker}
            onPrintWbSticker={handlePrintWbSticker}
            onReopenBox={onReopenBox}
            onDeleteBox={onDeleteBox}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default SupplyBoxCard;