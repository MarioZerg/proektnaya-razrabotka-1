import { useParams } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import useSupplyData from '@/components/crm/marketplaceSupplies/useSupplyData';
import useSupplyActions from '@/components/crm/marketplaceSupplies/useSupplyActions';
import useSupplyFlags from '@/components/crm/marketplaceSupplies/useSupplyFlags';
import SupplyShowContent from '@/components/crm/marketplaceSupplies/SupplyShowContent';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';

/**
 * Карточка поставки на маркетплейс.
 *
 * Страница собрана из четырёх частей, каждая со своей зоной ответственности:
 *   useSupplyData    — загрузка поставки, готовых вещей и справочника товаров;
 *   useSupplyActions — действия: сканирование, статусы, сохранение, удаление;
 *   useSupplyFlags   — права по ролям и режимы отображения (FBS/FBO, OZON/WB);
 *   SupplyShowContent — разметка карточки.
 *
 * Флаги считаются во вложенном компоненте: правило хуков не разрешает вызывать их
 * после раннего выхода по загрузке, а до загрузки поставки их считать не из чего.
 */
const MarketplaceSupplyShow = () => {
  const { id } = useParams();
  const supplyId = Number(id);

  const {
    supply,
    setSupply,
    loading,
    readyGoods,
    setReadyGoods,
    marketplaceItems,
    now,
    load,
    fields,
  } = useSupplyData(supplyId);

  const actions = useSupplyActions({
    supplyId,
    supply,
    setSupply,
    setReadyGoods,
    load,
    fields,
  });

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

  return (
    <CrmLayout>
      <SupplyShowLoaded
        supply={supply}
        supplyId={supplyId}
        now={now}
        readyGoods={readyGoods}
        marketplaceItems={marketplaceItems}
        load={load}
        fields={fields}
        actions={actions}
      />
    </CrmLayout>
  );
};

/** Внутренняя часть: показывается только когда поставка уже загружена. */
const SupplyShowLoaded = ({
  supply,
  supplyId,
  now,
  readyGoods,
  marketplaceItems,
  load,
  fields,
  actions,
}: {
  supply: SupplyDetail;
  supplyId: number;
  now: Date;
  readyGoods: ReturnType<typeof useSupplyData>['readyGoods'];
  marketplaceItems: ReturnType<typeof useSupplyData>['marketplaceItems'];
  load: (silent?: boolean) => void;
  fields: ReturnType<typeof useSupplyData>['fields'];
  actions: ReturnType<typeof useSupplyActions>;
}) => {
  const flags = useSupplyFlags(supply);

  return (
    <SupplyShowContent
      supply={supply}
      supplyId={supplyId}
      now={now}
      readyGoods={readyGoods}
      marketplaceItems={marketplaceItems}
      load={load}
      fields={fields}
      flags={flags}
      actions={actions}
    />
  );
};

export default MarketplaceSupplyShow;
