import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import SiteProductsTab from '@/components/crm/siteProducts/SiteProductsTab';
import WarehouseFetchError from '@/components/crm/goodsWarehouse/WarehouseFetchError';
import { fetchSiteStatus, type SiteStatus } from '@/lib/siteOrdersApi';

/** Интернет-магазин мегатюль.рф: товары, цены, прибыль, проценты блогера и налога. */
const MegatulShop = () => {
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    fetchSiteStatus()
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : 'Не удалось загрузить магазин'));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <CrmLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold">Магазин мегатюль.рф</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Карточки приходят с сайта. Здесь — расход, себестоимость, цены, прибыль и продажа на витрине.
          </p>
        </div>

        {error && <WarehouseFetchError title="Не удалось загрузить магазин" description={error} onRetry={load} />}

        {!status && !error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка…
          </div>
        )}

        {status && !status.connected && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <Icon name="PlugZap" size={16} className="mt-0.5 shrink-0" />
            <div>
              Магазин ещё не подключён: товары с сайта не загрузятся, цены не уйдут на витрину. Проценты
              расчёта можно настроить уже сейчас.{' '}
              <Link to="/crm/settings/marketplace-integrations" className="font-medium underline">
                Подключить в «Интеграциях»
              </Link>
            </div>
          </div>
        )}

        {status && <SiteProductsTab shopId={status.shopId} />}
      </div>
    </CrmLayout>
  );
};

export default MegatulShop;
