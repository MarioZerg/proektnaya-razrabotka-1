import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import GoodsWarehouseFilters from '@/components/crm/goodsWarehouse/GoodsWarehouseFilters';
import GoodsWarehouseTable from '@/components/crm/goodsWarehouse/GoodsWarehouseTable';
import GoodsWarehouseHeader from '@/components/crm/goodsWarehouse/GoodsWarehouseHeader';
import GoodsWarehouseWorkTiles from '@/components/crm/goodsWarehouse/GoodsWarehouseWorkTiles';
import GoodsWarehouseDialogs from '@/components/crm/goodsWarehouse/GoodsWarehouseDialogs';
import { useGoodsWarehouseState } from '@/components/crm/goodsWarehouse/useGoodsWarehouseState';
import TablePager from '@/components/crm/finance/TablePager';

const GoodsWarehouse = () => {
  const navigate = useNavigate();
  const s = useGoodsWarehouseState();

  return (
    <CrmLayout>
      <div className="space-y-6">
        <GoodsWarehouseHeader
          isAdmin={s.isAdmin}
          canReceiveManually={s.canReceiveManually}
          onMove={s.openMove}
          onAdminReceive={() => s.setAdminReceiveOpen(true)}
          onReprint={() => s.setReprintOpen(true)}
        />

        {/* Работа на сейчас — плитки с числами. Кладовщик видит, сколько вещей ждёт
            на каждом шаге, и нажимает ту, где есть работа: пустые остаются серыми и в
            глаза не лезут. */}
        <GoodsWarehouseWorkTiles
          pendingShelfCount={s.pendingShelf.length}
          pendingReturnsCount={s.pendingReturns.length}
          inspectedReady={s.inspectedReady}
          pickingPending={s.pickingPending}
          onPlace={() => s.setPlaceOpen(true)}
          onPickup={() => s.setPickupOpen(true)}
          onPlaceInspected={() => s.setPlaceInspectedOpen(true)}
        />

        <GoodsWarehouseDialogs
          isAdmin={s.isAdmin}
          canReceiveManually={s.canReceiveManually}
          shelves={s.shelves}
          pendingShelf={s.pendingShelf}
          placeOpen={s.placeOpen}
          setPlaceOpen={s.setPlaceOpen}
          pickupOpen={s.pickupOpen}
          setPickupOpen={s.setPickupOpen}
          placeInspectedOpen={s.placeInspectedOpen}
          setPlaceInspectedOpen={s.setPlaceInspectedOpen}
          moveOpen={s.moveOpen}
          setMoveOpen={s.setMoveOpen}
          adminReceiveOpen={s.adminReceiveOpen}
          setAdminReceiveOpen={s.setAdminReceiveOpen}
          reprintOpen={s.reprintOpen}
          setReprintOpen={s.setReprintOpen}
          load={s.load}
          loadInspectedReady={s.loadInspectedReady}
        />

        {/* Привезли с ПВЗ, но ещё не осмотрели. Такой товар нельзя продавать:
            он не проверен и в подбор не идёт, пока не ляжет на полку. */}
        {s.uncheckedReturns > 0 && (
          <button
            type="button"
            onClick={() => navigate('/crm/inventory/returns-inspection')}
            className="flex w-full items-center gap-3 rounded-lg border border-violet-300 bg-violet-50 px-4 py-3 text-left"
          >
            <Icon name="PackageOpen" size={24} className="shrink-0 text-violet-600" />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-violet-900">
                Непроверенные возвраты: {s.uncheckedReturns} шт.
              </p>
              <p className="text-sm text-violet-900">
                Забрали с пункта выдачи, но ещё не осмотрели. В подбор не попадут,
                пока не разберёте и не положите на полку
              </p>
            </div>
            <Icon name="ChevronRight" size={18} className="shrink-0 text-violet-600" />
          </button>
        )}

        {/* Фильтры и таблица — единый блок: между ними почти нет зазора, поэтому
            видно, что список подчиняется этим полям. Раньше их разделял отступ и
            строка со счётчиком, и связь читалась не сразу. */}
        <div className="space-y-2">
        <GoodsWarehouseFilters
          search={s.search}
          setSearch={s.setSearch}
          statusFilter={s.statusFilter}
          setStatusFilter={s.setStatusFilter}
          materialFilter={s.materialFilter}
          setMaterialFilter={s.setMaterialFilter}
          materials={s.materialsList}
          widthFilter={s.widthFilter}
          setWidthFilter={s.setWidthFilter}
          widths={s.widthsList}
          heightFilter={s.heightFilter}
          setHeightFilter={s.setHeightFilter}
          heights={s.heightsList}
          shelfCounts={s.shelfCounts}
          noShelfCount={s.noShelfCount}
          shelfFilter={s.shelfFilter}
          setShelfFilter={s.setShelfFilter}
          shelves={s.shelves}
          activeFiltersCount={s.activeFiltersCount}
          onReset={s.resetFilters}
          resultCount={s.filtered.length}
          loading={s.loading}
          shelfSelected={Boolean(s.shelfFilter)}
        />

        <GoodsWarehouseTable
          loading={s.loading}
          items={s.pagedItems}
          onReturnToWorkshop={s.handleReturn}
          onMarkLost={s.handleMarkLost}
          isAdmin={s.isAdmin}
          onDelete={s.handleDeleteGoods}
        />
        <TablePager page={s.page} totalPages={s.totalPages} total={s.total} setPage={s.setPage} />
        </div>
      </div>
    </CrmLayout>
  );
};

export default GoodsWarehouse;
