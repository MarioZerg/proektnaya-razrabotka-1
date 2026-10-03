import { Navigate } from 'react-router-dom';
import CrmLayout from '@/components/crm/CrmLayout';
import AiAssistantChat from '@/components/crm/AiAssistantChat';
import MegabuhAvatar from '@/components/crm/MegabuhAvatar';
import { AiAssistantProvider } from '@/hooks/useAiAssistant.ts';
import { useAuth } from '@/context/AuthContext';
import { isMegabuhRole } from '@/lib/roles';
import { givenName } from '@/lib/aiAssistantApi';

/** Чат МЕГАБУХ — бухгалтер и админ (раздел «Агенты»). */
const AssistantChat = () => {
  const { user } = useAuth();
  const megabuh = isMegabuhRole(user?.role);
  const name = givenName(user?.name);

  if (user && !megabuh) {
    return <Navigate to="/crm" replace />;
  }

  return (
    <CrmLayout>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mb-3 flex shrink-0 items-center gap-3">
          <MegabuhAvatar size={40} idleFlip />
          <div>
            <h1 className="text-xl font-semibold">МЕГАБУХ</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {`${name || 'Коллега'}, бухучёт, кадры, 1С и ЭДО.`}
            </p>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
          <AiAssistantProvider>
            <AiAssistantChat fill />
          </AiAssistantProvider>
        </div>
      </div>
    </CrmLayout>
  );
};

export default AssistantChat;
