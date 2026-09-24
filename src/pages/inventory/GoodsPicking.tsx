import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import PickingScanDialog from '@/components/crm/goodsWarehouse/PickingScanDialog';
import ShippedStuckPanel from '@/components/crm/goodsWarehouse/ShippedStuckPanel';
import SupplyTailsPanel from '@/components/crm/goodsWarehouse/SupplyTailsPanel';
import ExtraFboPanel from '@/components/crm/goodsWarehouse/ExtraFboPanel';
import GoodsPickingHeader from '@/components/crm/goodsWarehouse/GoodsPickingHeader';
import GoodsPickingFilters from '@/components/crm/goodsWarehouse/GoodsPickingFilters';
import GoodsPickingTable from '@/components/crm/goodsWarehouse/GoodsPickingTable';
import { useGoodsPicking } from '@/components/crm/goodsWarehouse/useGoodsPicking';

/**
 * Товар к подбору — заказы, под которые нужно найти готовую вещь на складе.
 *
 * Сюда падают новые заказы: их ещё не начали шить и готовая вещь под них не найдена.
 * Кладовщик смотрит список и решает, что можно закрыть складскими остатками.
 */
const GoodsPicking = () => {
  const navigate = useNavigate();
  const {
    loading,
    search,
    setSearch,
    scanOpen,
    setScanOpen,
    rematching,
    searchRef,
    load,
    handleRematch,
    labeledCount,
    extraItems,
    workOrders,
    filtered,
    byScheme,
    fbsCount,
    fboCount,
  } = useGoodsPicking();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <GoodsPickingHeader
          onBack={() => navigate('/crm/inventory/goods-warehouse')}
          onScan={() => setScanOpen(true)}
          onRematch={handleRematch}
          rematching={rematching}
          onReload={load}
          loading={loading}
        />

        <GoodsPickingFilters
          searchRef={searchRef}
          search={search}
          setSearch={setSearch}
          workOrdersCount={workOrders.length}
          fbsCount={fbsCount}
          fboCount={fboCount}
        />

        <PickingScanDialog
          open={scanOpen}
          onOpenChange={setScanOpen}
          onOpenCard={(goodsId) => navigate(`/crm/inventory/goods/${goodsId}`)}
        />

        {/* Позиции, которые уже уехали к клиентам: их закрывает администратор,
            иначе они висят в подборе вечно. */}
        <ShippedStuckPanel onReload={load} />

        {/* Вещи на полках, за которыми тянется запись старой уехавшей поставки.
            Кладовщик держит вещь в руках, а система говорит «в поставке FBO» —
            снимаем запись, и спор с очевидностью заканчивается. */}
        <SupplyTailsPanel onReload={load} />

        {/* Собрано сверх плана заявки FBO. Вещь обезличена, и в короб уехала
            соседняя такая же — а эта осталась с ярлыком поставки и чужой
            бронью. В короб её нести не надо: заявка этот размер уже набрала.
            Возвращаем такие вещи на полки, иначе они лежат мёртвым остатком. */}
        <ExtraFboPanel items={extraItems} onReload={load} />

        {/* Сколько вещей уже со стикером. Это не отдельный список, а подсказка:
            такие строки помечены в таблице, и по ним осталось одно действие —
            отправить на поставку из карточки. */}
        {labeledCount > 0 && (
          <div className="flex gap-2 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
            <Icon name="Info" size={18} className="mt-0.5 shrink-0" />
            <div>
              Со стикером: {labeledCount}. Такие вещи помечены в списке — найдите их на
              полке и отправьте на поставку кнопкой в карточке. До этого они никуда
              не едут и из списка не пропадают.
            </div>
          </div>
        )}

        <GoodsPickingTable
          loading={loading}
          search={search}
          workOrders={workOrders}
          filtered={filtered}
          byScheme={byScheme}
          onOpenCard={(goodsId) => navigate(`/crm/inventory/goods/${goodsId}`)}
        />
      </div>
    </CrmLayout>
  );
};

export default GoodsPicking;