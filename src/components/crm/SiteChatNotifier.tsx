import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { fetchSiteChatUnread, SITE_CHAT_CHANGED, type SiteChatUnread } from '@/lib/siteOrdersApi';

const plural = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'новое сообщение';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'новых сообщения';
  return 'новых сообщений';
};

/**
 * Компактная плашка в шапке: «1 новое сообщение · мегатюль.рф».
 * Видна только администратору и только когда есть непрочитанные.
 * Клик — сразу в чат магазина на странице «Интеграции».
 */
const SiteChatNotifier = () => {
  const { user } = useAuth();
  const location = useLocation();
  const [data, setData] = useState<SiteChatUnread | null>(null);
  const isAdmin = user?.role === 'admin' && !user.isImpersonated;

  const check = useCallback(() => {
    if (!isAdmin || document.hidden) return;
    fetchSiteChatUnread({ id: user?.id, name: user?.name })
      .then(setData)
      .catch(() => {});
  }, [isAdmin, user?.id, user?.name]);

  useEffect(() => {
    if (!isAdmin) return;
    check();
    const t = window.setInterval(check, 60000);
    const onChange = () => window.setTimeout(check, 500);
    window.addEventListener(SITE_CHAT_CHANGED, onChange);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(t);
      window.removeEventListener(SITE_CHAT_CHANGED, onChange);
      document.removeEventListener('visibilitychange', check);
    };
  }, [isAdmin, check]);

  if (!isAdmin || !data || !data.unread) return null;

  const onChatPage =
    location.pathname === '/crm/settings/marketplace-integrations' &&
    location.search.includes('tab=chats');

  return (
    <Link
      to="/crm/settings/marketplace-integrations?tab=chats"
      title={data.lastClient ? `${data.lastClient}: ${data.lastText || ''}` : 'Чат с покупателями мегатюль.рф'}
      className={`flex min-w-0 shrink items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 shadow-sm transition hover:bg-red-100 ${
        onChatPage ? 'opacity-70' : ''
      }`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
      <Icon name="MessageCircle" size={14} className="shrink-0" />
      <span className="truncate">
        {data.unread} <span className="hidden sm:inline">{plural(data.unread)} · </span>мегатюль.рф
      </span>
    </Link>
  );
};

export default SiteChatNotifier;
