import { useEffect, useState } from 'react';
import CrmLayout from '@/components/crm/CrmLayout';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  fetchMarketplaceIntegrations,
  updateMarketplaceIntegration,
  type MarketplaceIntegration,
} from '@/lib/marketplaceIntegrationsApi';
import { marketplaceIntegrationsConfig } from '@/lib/marketplaceIntegrationsConfig';
import MarketplaceIntegrationCard from '@/components/crm/settings/MarketplaceIntegrationCard';

const MarketplaceIntegrationsSettings = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [integrations, setIntegrations] = useState<MarketplaceIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingCode, setSavingCode] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchMarketplaceIntegrations()
      .then(setIntegrations)
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
      await updateMarketplaceIntegration(code, { credentials, isEnabled }, user?.id);
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
      await updateMarketplaceIntegration(code, { isEnabled }, user?.id);
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {marketplaceIntegrationsConfig.map((config) => (
              <MarketplaceIntegrationCard
                key={config.code}
                config={config}
                integration={integrations.find((i) => i.marketplaceCode === config.code)}
                saving={savingCode === config.code}
                onSave={(credentials, isEnabled) => handleSave(config.code, credentials, isEnabled)}
                onToggle={(isEnabled) => handleToggle(config.code, isEnabled)}
              />
            ))}
          </div>
        )}
      </div>
    </CrmLayout>
  );
};

export default MarketplaceIntegrationsSettings;
