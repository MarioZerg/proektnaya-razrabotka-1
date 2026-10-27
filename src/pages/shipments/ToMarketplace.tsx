import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import { useAuth } from '@/context/AuthContext';
import ShopTabs from '@/components/crm/ShopTabs';
import CreateOzonFboDialog from '@/components/crm/marketplaceSupplies/CreateOzonFboDialog';
import SupplyTypeWidgets from '@/components/crm/marketplaceSupplies/SupplyTypeWidgets';
import ToMarketplaceFilters from '@/components/crm/marketplaceSupplies/ToMarketplaceFilters';
import ToMarketplaceTable from '@/components/crm/marketplaceSupplies/ToMarketplaceTable';
import FboProposalsPanel from '@/components/crm/marketplaceSupplies/FboProposalsPanel';
import ConfirmFbsSupplyDialog from '@/components/crm/marketplaceSupplies/ConfirmFbsSupplyDialog';
import { createOptions } from '@/components/crm/marketplaceSupplies/toMarketplaceConstants';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import useMarketplaceSuppliesList from '@/components/crm/marketplaceSupplies/useMarketplaceSuppliesList';
import useSupplyCreation from '@/components/crm/marketplaceSupplies/useSupplyCreation';
import ToMarketplaceHeader from '@/components/crm/marketplaceSupplies/ToMarketplaceHeader';
import CloseReadySupplyDialog from '@/components/crm/marketplaceSupplies/CloseReadySupplyDialog';

const ToMarketplace = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  // FBS-поставки создаёт и собирает кладовщик — товар он отбирает со своих полок. Менеджер
  // ведёт FBO-поставки и только наблюдает за сборкой FBS в реальном времени.
  const isManagerRole = user?.role === 'manager';
  const availableCreateOptions = isManagerRole
    ? createOptions.filter((o) => o.type !== 'FBS')
    : createOptions;

  const list = useMarketplaceSuppliesList();
  const {
    allSupplies,
    supplies,
    loading,
    listError,
    load,
    shops,
    shopId,
    setShopId,
    currentShop,
    typeFilter,
    setTypeFilter,
  } = list;

  const creation = useSupplyCreation(allSupplies, shopId);

  // Магазин мегатюль.рф: у него одна поставка в день — «Отгрузка» в Ozon Доставку.
  const isSiteShop = currentShop?.code === 'megatul_site';
  const shopCreateOptions = isSiteShop
    ? [{ marketplace: 'IM', type: 'FBS' as const, label: 'Отгрузка' }]
    : availableCreateOptions;

  const [feed, setFeed] = useState<'supplies' | 'proposals'>('supplies');

  return (
    <CrmLayout>
      <div className="space-y-4">
        <ToMarketplaceHeader
          currentShop={currentShop}
          creating={creation.creating}
          availableCreateOptions={shopCreateOptions}
          onCreate={creation.handleCreate}
        />

        {/* Вкладки магазинов. У МЕГАТЮЛЬ и ДЮНЫ разные кабинеты на площадке:
            поставки собираются отдельно, а вещь чужого магазина в короб не
            отсканируется. Пока магазин один, вкладки не рисуются. */}
        <ShopTabs shops={shops} value={shopId} onChange={setShopId} />

        {!isSiteShop && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant={feed === 'supplies' ? 'default' : 'outline'}
            onClick={() => setFeed('supplies')}
          >
            Поставки
          </Button>
          <Button
            type="button"
            variant={feed === 'proposals' ? 'default' : 'outline'}
            onClick={() => setFeed('proposals')}
          >
            Авто предложения поставки FBO
          </Button>
        </div>
        )}

        {feed === 'proposals' && !isSiteShop ? (
          <FboProposalsPanel
            shopId={shopId}
            actorId={user?.id}
            actorName={user?.name}
            isAdmin={user?.role === 'admin'}
            onOpenSupply={(id) => {
              setFeed('supplies');
              navigate(`/crm/shipments/to-marketplace/${id}`);
            }}
          />
        ) : (
        <>
        {/* Создание, схема и фильтры — одна верхняя полоса, список сразу под ней. */}
        <div className="space-y-3">
          {!loading && allSupplies.length > 0 && !isSiteShop && (
            <SupplyTypeWidgets
              supplies={allSupplies}
              activeType={typeFilter}
              onSelectType={setTypeFilter}
            />
          )}
          <ToMarketplaceFilters
            statusFilter={list.statusFilter}
            setStatusFilter={list.setStatusFilter}
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            marketplaceFilter={list.marketplaceFilter}
            setMarketplaceFilter={list.setMarketplaceFilter}
            dateFrom={list.dateFrom}
            setDateFrom={list.setDateFrom}
            dateTo={list.dateTo}
            setDateTo={list.setDateTo}
            search={list.search}
            setSearch={list.setSearch}
            onReset={list.resetFilters}
          />
        </div>

        {listError && (
          <WarehouseFetchError
            title="Не удалось загрузить поставки"
            description={listError}
            onRetry={load}
          />
        )}

        <ToMarketplaceTable
          loading={loading}
          error={listError}
          supplies={supplies}
          onOpen={(id) => navigate(`/crm/shipments/to-marketplace/${id}`)}
        />
        </>
        )}
      </div>

      <CloseReadySupplyDialog
        closeToCreate={creation.closeToCreate}
        setCloseToCreate={creation.setCloseToCreate}
        onConfirm={creation.closeReadyAndCreate}
      />

      <ConfirmFbsSupplyDialog
        pendingFbs={creation.pendingFbs}
        setPendingFbs={creation.setPendingFbs}
        onConfirm={creation.createSupplyNow}
      />

      <CreateOzonFboDialog
        open={creation.ozonFboDialogOpen}
        onOpenChange={creation.setOzonFboDialogOpen}
        creating={creation.creating}
        onImportApplication={creation.handleImportOzonApplication}
        onCreateDraft={creation.handleCreateOzonDraft}
      />
    </CrmLayout>
  );
};

export default ToMarketplace;
