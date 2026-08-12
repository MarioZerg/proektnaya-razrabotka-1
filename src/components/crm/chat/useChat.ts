import { useCallback, useEffect, useRef, useState } from 'react';
import { withNightSlowdown } from '@/lib/workingHours';
import {
  fetchMessages,
  fetchNewMessages,
  fetchOlderMessages,
  sendMessage,
  hideMessage,
  type ChatMessage,
} from '@/lib/chatApi';

/** Как часто спрашиваем новые сообщения, когда человек смотрит в чат. */
const ACTIVE_INTERVAL = 3000;
/**
 * Пауза, когда вкладку свернули или человек отошёл. Чат на планшете в цехе может
 * висеть открытым всю смену: без этого он молотил бы запросы восемь часов подряд
 * впустую и просто жёг лимит вызовов.
 */
const IDLE_INTERVAL = 30000;
/** Через сколько бездействия считаем, что человек отошёл от планшета. */
const IDLE_AFTER = 60000;

/**
 * Лента чата в реальном времени.
 *
 * Новые сообщения забираются «добавкой»: спрашиваем только то, что появилось после
 * последнего известного id. Такой запрос почти всегда возвращает пустой список и
 * стоит копейки — в отличие от перечитывания всей ленты каждые несколько секунд.
 *
 * Частота опроса подстраивается под человека: смотрит в чат — обновляем часто,
 * свернул вкладку или отошёл — реже. Это экономит и лимит вызовов, и батарею планшета.
 */
export const useChat = (userId?: number, userName?: string) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  // Последний известный id — точка отсчёта для добавки.
  const lastIdRef = useRef(0);
  // Время последнего действия человека: по нему решаем, как часто опрашивать.
  const lastActivityRef = useRef(Date.now());
  // Опрос уже идёт — второй параллельный запускать нельзя, иначе при медленной
  // сети запросы наложатся друг на друга и посыплются дубли сообщений.
  const pollingRef = useRef(false);

  const applyIncoming = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      // Своё сообщение уже показано сразу после отправки — второй раз не добавляем.
      const known = new Set(prev.map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id));
      if (!fresh.length) return prev;
      return [...prev, ...fresh];
    });
    const maxId = Math.max(...incoming.map((m) => m.id));
    if (maxId > lastIdRef.current) lastIdRef.current = maxId;
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    fetchMessages()
      .then((data) => {
        setMessages(data.messages);
        setHasMore(data.hasMore);
        if (data.messages.length) {
          lastIdRef.current = data.messages[data.messages.length - 1].id;
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Любое действие человека продлевает «активный» режим опроса.
  useEffect(() => {
    const touch = () => {
      lastActivityRef.current = Date.now();
    };
    window.addEventListener('keydown', touch);
    window.addEventListener('mousemove', touch);
    window.addEventListener('touchstart', touch);
    window.addEventListener('focus', touch);
    return () => {
      window.removeEventListener('keydown', touch);
      window.removeEventListener('mousemove', touch);
      window.removeEventListener('touchstart', touch);
      window.removeEventListener('focus', touch);
    };
  }, []);

  useEffect(() => {
    let timer: number;

    const tick = async () => {
      const hidden = document.hidden;
      const idle = Date.now() - lastActivityRef.current > IDLE_AFTER;
      // Вкладка свёрнута — не спрашиваем вообще: человек всё равно не увидит.
      // Вернётся на вкладку — сработает обработчик ниже и догрузит пропущенное.
      if (!hidden && !pollingRef.current) {
        pollingRef.current = true;
        try {
          applyIncoming(await fetchNewMessages(lastIdRef.current));
        } catch {
          // Сеть моргнула — молча ждём следующего круга, ошибку показывать незачем.
        } finally {
          pollingRef.current = false;
        }
      }
      // Ночью (с 24:00 до 5:00) опрос замедляется: производство не работает, и чат,
      // забытый открытым на планшете, не должен всю ночь дёргать сервер.
      timer = window.setTimeout(
        tick,
        withNightSlowdown(hidden || idle ? IDLE_INTERVAL : ACTIVE_INTERVAL),
      );
    };

    timer = window.setTimeout(tick, withNightSlowdown(ACTIVE_INTERVAL));
    return () => window.clearTimeout(timer);
  }, [applyIncoming]);

  // Вернулись на вкладку — сразу подтягиваем всё, что пришло, пока её не смотрели.
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      lastActivityRef.current = Date.now();
      fetchNewMessages(lastIdRef.current).then(applyIncoming).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [applyIncoming]);

  const send = async (text: string) => {
    const value = text.trim();
    if (!value || !userId) return;
    setSending(true);
    try {
      const message = await sendMessage(userId, userName || '', value);
      // Показываем своё сообщение сразу, не дожидаясь следующего опроса: иначе
      // возникает ощущение, что кнопка не сработала.
      applyIncoming([message]);
    } finally {
      setSending(false);
    }
  };

  const hide = async (id: number) => {
    if (!userId) return;
    await hideMessage(id, userId);
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  const loadOlder = async () => {
    if (!messages.length || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const data = await fetchOlderMessages(messages[0].id);
      setMessages((prev) => [...data.messages, ...prev]);
      setHasMore(data.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  };

  return { messages, loading, sending, send, hide, hasMore, loadingOlder, loadOlder };
};

export default useChat;
