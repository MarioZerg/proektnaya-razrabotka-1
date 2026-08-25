import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchMarketplaceIntegrations,
  updateMarketplaceIntegration,
  type MarketplaceIntegration,
  type Shop,
} from '@/lib/marketplaceIntegrationsApi';
import { marketplaceIntegrationsConfig } from '@/lib/marketplaceIntegrationsConfig';
import MarketplaceIntegrationCard from '@/components/crm/settings/MarketplaceIntegrationCard';

const MarketplaceIntegrationsSettings = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [integrations, setIntegrations] = useState<MarketplaceIntegration[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  // Какой магазин настраиваем сейчас. Кабинеты разные, производство общее.
  const [shopId, setShopId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchMarketplaceIntegrations()
      .then(({ integrations: list, shops: shopList }) => {
        setIntegrations(list);
        setShops(shopList);
        setShopId((prev) => prev ?? shopList[0]?.id ?? null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async (
    code: MarketplaceIntegration['marketplaceCode'],
    credentials: Record<string, string>,
    isEnabled: boolean
  ) => {
    setSavingCode(code);
    try {
      if (!shopId) return;
      await updateMarketplaceIntegration(code, shopId, { credentials, isEnabled }, user?.id);
      toast({ title: 'Настройки сохранены' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSavingCode(null);
    }
  };

  const handleToggle = async (code: MarketplaceIntegration['marketplaceCode'], isEnabled: boolean) => {
    setSavingCode(code);
    try {
      if (!shopId) return;
      await updateMarketplaceIntegration(code, shopId, { isEnabled }, user?.id);
      toast({ title: isEnabled ? 'Интеграция включена' : 'Интеграция отключена' });
      load();
    } catch (e) {
      toast({ title: 'Ошибка', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSavingCode(null);
    }
  };

  return (
    <CrmLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold">Интеграции с маркетплейсами</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Подключите API-ключи маркетплейсов — отсюда система будет брать данные для
            синхронизации заказов, остатков и цен
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon name="Loader2" size={16} className="animate-spin" />
            Загрузка...
          </div>
        ) : (
          <>
            {/* Вкладки магазинов. У каждого свой кабинет на площадке и свои
                ключи — перепутать их нельзя, иначе заказы уйдут не туда.
                Показываем вкладки только когда магазинов правда несколько. */}
            {shops.length > 1 && (
              <div className="flex flex-wrap gap-2 border-b border-border pb-3">
                {shops.map((shop) => {
                  const active = shop.id === shopId;
                  const connected = integrations.filter(
                    (i) => i.shopId === shop.id && i.isEnabled,
                  ).length;
                  return (
                    <button
                      key={shop.id}
                      type="button"
                      onClick={() => setShopId(shop.id)}
                      className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-semibold transition ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <Icon name="Store" size={15} />
                      {shop.name}
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                          active ? 'bg-primary-foreground/20' : 'bg-muted'
                        }`}
                      >
                        {connected}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {marketplaceIntegrationsConfig.map((config) => (
                <MarketplaceIntegrationCard
                  key={`${shopId}-${config.code}`}
                  config={config}
                  integration={integrations.find(
                    (i) => i.marketplaceCode === config.code && i.shopId === shopId,
                  )}
                  saving={savingCode === config.code}
                  onSave={(credentials, isEnabled) => handleSave(config.code, credentials, isEnabled)}
                  onToggle={(isEnabled) => handleToggle(config.code, isEnabled)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </CrmLayout>
  );
};

export default MarketplaceIntegrationsSettings;
