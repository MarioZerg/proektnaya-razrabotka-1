import { Navigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import ShopAssistantChat from '@/components/crm/ShopAssistantChat';
import MegamagAvatar from '@/components/crm/MegamagAvatar';
import { MarketplaceAssistantProvider } from '@/hooks/useMarketplaceAssistant';
import { useAuth } from '@/context/AuthContext';
import { isMegamagRole } from '@/lib/roles';
import { givenName } from '@/lib/aiAssistantApi';

/** Чат МЕГАМАГ — кабинеты маркетплейсов, только у менеджера. */
const ShopAssistantPage = () => {
  const { user } = useAuth();
  const allowed = isMegamagRole(user?.role);
  const name = givenName(user?.name);

  if (user && !allowed) {
    return <Navigate to="/crm" replace />;
  }

  return (
    <CrmLayout>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mb-3 flex shrink-0 items-center gap-3">
          <MegamagAvatar size={40} />
          <div>
            <h1 className="text-xl font-semibold">МЕГАМАГ</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {`${name || 'Коллега'}, кабинеты OZON, Wildberries и Яндекс Маркета: карточки, SEO, реклама.`}
            </p>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
          <MarketplaceAssistantProvider>
            <ShopAssistantChat fill />
          </MarketplaceAssistantProvider>
        </div>
      </div>
    </CrmLayout>
  );
};

export default ShopAssistantPage;
