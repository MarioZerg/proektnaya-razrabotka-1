import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import PickingScanDialog from '@/components/crm/goodsWarehouse/PickingScanDialog';
import ShippedStuckPanel from '@/components/crm/goodsWarehouse/ShippedStuckPanel';
import ExtraFboPanel from '@/components/crm/goodsWarehouse/ExtraFboPanel';
import NoShelfPanel from '@/components/crm/goodsWarehouse/NoShelfPanel';
import GoodsPickingHeader from '@/components/crm/goodsWarehouse/GoodsPickingHeader';
import GoodsPickingFilters from '@/components/crm/goodsWarehouse/GoodsPickingFilters';
import GoodsPickingTable from '@/components/crm/goodsWarehouse/GoodsPickingTable';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
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
    listError,
    search,
    setSearch,
    scanOpen,
    setScanOpen,
    rematching,
    searchRef,
    load,
    handleRematch,
    labeledCount,
    labeledFbs,
    labeledFbo,
    labeledOnly,
    setLabeledOnly,
    extraItems,
    workOrders,
    filtered,
    byScheme,
    fbsCount,
    fboCount,
    shelfFilter,
    setShelfFilter,
    shelfStats,
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
          shelfFilter={shelfFilter}
          setShelfFilter={setShelfFilter}
          shelfStats={shelfStats}
        />

        {/* Вещь не может лежать без полки: такие показываем первыми, с выбором
            полки прямо в строке. */}
        <NoShelfPanel />

        <PickingScanDialog
          open={scanOpen}
          onOpenChange={setScanOpen}
          onOpenCard={(goodsId) => navigate(`/crm/inventory/goods/${goodsId}`)}
        />

        {/* Позиции, которые уже уехали к клиентам: их закрывает администратор,
            иначе они висят в подборе вечно. */}
        <ShippedStuckPanel onReload={load} />

        {/* Собрано сверх плана заявки FBO. Вещь обезличена, и в короб уехала
            соседняя такая же — а эта осталась с ярлыком поставки и чужой
            бронью. В короб её нести не надо: заявка этот размер уже набрала.
            Возвращаем такие вещи на полки, иначе они лежат мёртвым остатком. */}
        <ExtraFboPanel items={extraItems} onReload={load} />

        {/* Сколько вещей уже со стикером. Это не отдельный список, а подсказка:
            такие строки помечены в таблице, и по ним осталось одно действие —
            отправить на поставку из карточки. */}
        {labeledCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-300 bg-sky-50 p-3 text-sky-900">
            <div className="flex items-start gap-2">
              <Icon name="Tag" size={20} className="mt-0.5 shrink-0 text-sky-600" />
              <div>
                <p className="text-sm font-semibold">
                  Застикеровано, но не добавлено в поставку: {labeledCount}
                  {(labeledFbs > 0 || labeledFbo > 0) && (
                    <span className="font-normal">
                      {' '}
                      ({[labeledFbs > 0 && `FBS ${labeledFbs}`, labeledFbo > 0 && `FBO ${labeledFbo}`]
                        .filter(Boolean)
                        .join(', ')})
                    </span>
                  )}
                </p>
                <p className="text-xs text-sky-800">
                  Ярлык уже наклеен — осталось отсканировать вещь в короб или поставку FBS.
                  Эти вещи закреплены за заказами, освободить их нельзя
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant={labeledOnly ? 'default' : 'outline'}
              onClick={() => setLabeledOnly(!labeledOnly)}
            >
              <Icon name={labeledOnly ? 'X' : 'Filter'} size={14} className="mr-1.5" />
              {labeledOnly ? 'Показать все' : 'Показать только их'}
            </Button>
          </div>
        )}

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить подбор"
            description={listError}
            onRetry={load}
          />
        )}

        <GoodsPickingTable
          loading={loading}
          error={listError}
          search={search}
          shelfFilter={shelfFilter}
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