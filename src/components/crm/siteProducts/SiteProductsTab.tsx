import { Fragment } from 'react';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import SitePricingPanel from '@/components/crm/siteProducts/SitePricingPanel';
import SiteItemMaterialsDialog from '@/components/crm/siteProducts/SiteItemMaterialsDialog';
import SiteProductsFilters from '@/components/crm/siteProducts/SiteProductsFilters';
import SiteMaterialRow from '@/components/crm/siteProducts/SiteMaterialRow';
import SiteWidthRow from '@/components/crm/siteProducts/SiteWidthRow';
import useSiteProducts from '@/components/crm/siteProducts/useSiteProducts';

/** Товары мегатюль.рф: одна строка — одна ширина карточки, внутри все её высоты. */
const SiteProductsTab = ({ shopId }: { shopId: number }) => {
  const {
    items,
    pricing,
    setPricing,
    materials,
    loading,
    syncing,
    query,
    setQuery,
    view,
    setView,
    product,
    setProduct,
    editing,
    setEditing,
    toggling,
    open,
    openMaterials,
    isAdmin,
    actor,
    load,
    handleSync,
    active,
    lowProfit,
    targetOf,
    widths,
    costByWidth,
    noFabric,
    priceOf,
    toggleDisabled,
    toggleMaterialDisabled,
    productOptions,
    shown,
    materialGroups,
    autoOpen,
    toggleMaterial,
    toggleOpen,
    views,
  } = useSiteProducts(shopId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Название, артикул и размер приходят с сайта. Себестоимость — из «Себестоимости товара», если
          проставлен расход. Цена и включение товара отправляются на сайт.
        </p>
        <Button onClick={handleSync} disabled={syncing}>
          <Icon
            name={syncing ? 'Loader2' : 'RefreshCw'}
            size={16}
            className={`mr-1.5 ${syncing ? 'animate-spin' : ''}`}
          />
          {syncing ? 'Загружаю…' : 'Загрузить товары с сайта'}
        </Button>
      </div>

      <SitePricingPanel
        pricing={pricing}
        widths={widths}
        costByWidth={costByWidth}
        canEdit={isAdmin}
        actor={actor}
        onSaved={setPricing}
      />

      {noFabric.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <Icon name="TriangleAlert" size={16} className="mt-0.5 shrink-0" />
          <span>
            Ткани без материала в системе:{' '}
            <b>{[...new Set(noFabric.map((g) => g.title))].join(', ')}</b>. Без неё не посчитать себестоимость и
            подсказку цены — заведите ткань в «Материалах» и укажите её в расходе карточки.
          </span>
        </div>
      )}

      <SiteProductsFilters
        views={views}
        view={view}
        onView={setView}
        product={product}
        onProduct={setProduct}
        productOptions={productOptions}
        query={query}
        onQuery={setQuery}
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={16} className="animate-spin" />
          Загрузка…
        </div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {items.length === 0
            ? 'Товаров пока нет — нажмите «Загрузить товары с сайта».'
            : 'Ничего не найдено.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Карточка</th>
                <th className="px-3 py-2 font-medium">Ширина</th>
                <th className="px-3 py-2 font-medium">Высоты</th>
                <th className="px-3 py-2 font-medium">Расход</th>
                <th className="px-3 py-2 font-medium">Себестоимость</th>
                <th className="px-3 py-2 font-medium">Цена на сайте</th>
                <th className="px-3 py-2 font-medium">Чистая прибыль</th>
                <th className="px-3 py-2 font-medium">На сайте</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {materialGroups.map(([title, groups]) => {
                const matOpen = autoOpen || openMaterials.has(title);
                const matAll = active.filter((g) => g.title === title);
                const matDisabled = matAll.length > 0 && matAll.every((g) => g.disabled);
                return (
                  <Fragment key={title}>
                    <SiteMaterialRow
                      title={title}
                      groups={groups}
                      matOpen={matOpen}
                      matDisabled={matDisabled}
                      lowProfit={lowProfit}
                      priceOf={priceOf}
                      canToggle={isAdmin && view !== 'archived'}
                      toggling={toggling}
                      onToggleOpen={toggleMaterial}
                      onToggleDisabled={toggleMaterialDisabled}
                    />
                    {matOpen &&
                      groups.map((g) => (
                        <SiteWidthRow
                          key={g.key}
                          g={g}
                          isOpen={open.has(g.key)}
                          pricing={pricing}
                          isAdmin={isAdmin}
                          actor={actor}
                          toggling={toggling}
                          priceOf={priceOf}
                          targetOf={targetOf}
                          onToggleOpen={toggleOpen}
                          onToggleDisabled={toggleDisabled}
                          onEdit={setEditing}
                          onSaved={load}
                        />
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <SiteItemMaterialsDialog
        group={editing}
        materials={materials}
        onClose={() => setEditing(null)}
        onSaved={load}
      />
    </div>
  );
};

export default SiteProductsTab;
