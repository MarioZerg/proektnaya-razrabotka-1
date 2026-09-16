import { useCallback, useEffect, useRef, useState } from 'react';
import { withNightSlowdown } from '@/lib/workingHours';
import {
  fetchMessages,
  fetchNewMessages,
  fetchOlderMessages,
  sendMessage,
  hideMessage,
  saveOwnAvatar,
  type ChatMe,
  type ChatMessage,
  type ChatPresenceUser,
} from '@/lib/chatApi';

/**
 * Как часто спрашиваем новые сообщения, когда в чате идёт разговор.
 *
 * Живая переписка — это вопрос и ответ через несколько секунд. Если между «где
 * рулон Лена?» и появлением ответа на экране проходит десять секунд, человек
 * успевает решить, что его не услышали, и уходит в цех ногами. Три секунды —
 * порог, на котором ответ выглядит мгновенным.
 */
const LIVE_INTERVAL = 3000;

/**
 * Предел, до которого опрос замедляется, пока в чате тихо.
 *
 * Чат открыт на планшете всю смену, и большую часть времени в нём никто не пишет.
 * Опрашивать сервер каждые три секунды восемь часов подряд — это десять тысяч
 * оплаченных вызовов в пустоту на каждый планшет. Поэтому в тишине интервал
 * растёт, а от первого же сообщения (или движения человека) снова падает до трёх
 * секунд: платим за частый опрос только там, где идёт разговор.
 */
const QUIET_INTERVAL = 20000;

/** Во сколько раз замедляем опрос за каждый «пустой» круг, пока в чате тихо. */
const SLOWDOWN_STEP = 1.4;

/**
 * Пауза, когда в чат никто не смотрит: вкладку свернули или человек отошёл.
 *
 * Планшет в цехе висит с открытым чатом всю смену, и большую часть времени рядом
 * никого нет. Держать для него живой опрос — платить за пустые ответы. Но и совсем
 * замирать нельзя: мимо планшета проходят и читают ленту, не прикасаясь к экрану.
 * Как только человек до него дотронется, лента обновится немедленно (см. ниже).
 */
const IDLE_INTERVAL = 45000;

/** Через сколько бездействия считаем, что рядом с планшетом никого нет. */
const IDLE_AFTER = 120000;

/** Как часто отмечаемся «я в чате», чтобы у остальных горела зелёная точка. */
const PRESENCE_PING_MS = 30000;

/** Сколько секунд после нажатия клавиши считаем, что человек ещё печатает. */
const TYPING_HOLD_MS = 4000;

/** Отправляемые сообщения нумеруем отрицательными id — они не столкнутся с базой. */
let localIdSeq = -1;

interface ChatState {
  messages: ChatMessage[];
  loading: boolean;
  hasMore: boolean;
  loadingOlder: boolean;
  /** Кто сейчас смотрит в чат (без себя). */
  online: ChatPresenceUser[];
  /** Кто прямо сейчас набирает сообщение (без себя). */
  typing: ChatPresenceUser[];
  /** Связи с сервером нет — лента могла отстать, об этом честно говорим. */
  offline: boolean;
}

/**
 * Лента чата в реальном времени.
 *
 * Новые сообщения забираются «добавкой»: спрашиваем только то, что появилось после
 * последнего известного id. Такой запрос почти всегда возвращает пустой список и
 * стоит копейки — в отличие от перечитывания всей ленты каждые несколько секунд.
 *
 * Частота опроса подстраивается под разговор: пока люди пишут — обновляем каждые
 * три секунды, в тишине интервал плавно растёт, свернули вкладку — опрос замирает
 * до возвращения. Это даёт ощущение живого чата, не оплачивая тысячи пустых
 * запросов с каждого планшета в цехе.
 */
export const useChat = (userId?: number) => {
  const [state, setState] = useState<ChatState>({
    messages: [],
    loading: true,
    hasMore: false,
    loadingOlder: false,
    online: [],
    typing: [],
    offline: false,
  });
  const [me, setMe] = useState<ChatMe | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);

  // Последний известный id — точка отсчёта для добавки.
  const lastIdRef = useRef(0);
  // Время последнего действия человека: по нему решаем, как часто опрашивать.
  const lastActivityRef = useRef(Date.now());
  // Опрос уже идёт — второй параллельный запускать нельзя, иначе при медленной
  // сети запросы наложатся друг на друга и посыплются дубли сообщений.
  const pollingRef = useRef(false);
  // Текущая пауза между опросами: растёт в тишине, падает от любого события.
  const intervalRef = useRef(LIVE_INTERVAL);
  // Когда последний раз отмечались «я в чате».
  const lastPingRef = useRef(0);
  // Когда последний раз нажимали клавишу в поле ввода.
  const lastTypedRef = useRef(0);
  // Разбудить опрос немедленно (отправили сообщение, вернулись на вкладку).
  const wakeRef = useRef<() => void>(() => {});
  // Подгрузка истории уже идёт — второй запрос не нужен.
  const loadingOlderRef = useRef(false);

  /** Возвращает опрос к частоте живого разговора. */
  const goLive = useCallback(() => {
    intervalRef.current = LIVE_INTERVAL;
  }, []);

  const applyIncoming = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    setState((prev) => {
      const known = new Set(prev.messages.map((m) => m.id));
      const fresh = incoming.filter((m) => !known.has(m.id));
      if (!fresh.length) return prev;
      // Свои сообщения уже стоят в ленте как отправляемые, чужие приходят в конец —
      // общий порядок по id, чтобы при медленной сети ничего не встало вверх ногами.
      return { ...prev, messages: [...prev.messages, ...fresh] };
    });
    const maxId = Math.max(...incoming.map((m) => m.id));
    if (maxId > lastIdRef.current) lastIdRef.current = maxId;
  }, []);

  const load = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true }));
    fetchMessages()
      .then((data) => {
        setState((prev) => ({
          ...prev,
          // Неотправленные сообщения при перезагрузке ленты не теряем: человек
          // писал их не для того, чтобы они исчезли из-за моргнувшей связи.
          messages: [...data.messages, ...prev.messages.filter((m) => m.status === 'failed')],
          hasMore: data.hasMore,
          // Себя из списка «в сети» убираем: человек и так знает, что он в чате, а
          // своё лицо среди собеседников только сбивает с толку.
          online: data.online.filter((p) => p.userId !== userId),
          typing: data.typing.filter((p) => p.userId !== userId),
          loading: false,
          offline: false,
        }));
        setMe(data.me);
        if (data.messages.length) {
          lastIdRef.current = data.messages[data.messages.length - 1].id;
        }
      })
      .catch(() => setState((prev) => ({ ...prev, loading: false, offline: true })));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  // Любое действие человека продлевает «живой» режим опроса.
  useEffect(() => {
    const touch = () => {
      // Человек вернулся к замедленному чату — обновляем ленту сразу, а не через
      // сорок секунд. Иначе первое, что он видит, подойдя к планшету, — вчерашний
      // конец переписки, и только потом на неё падают пропущенные сообщения.
      const wasAway = Date.now() - lastActivityRef.current > IDLE_AFTER;
      lastActivityRef.current = Date.now();
      if (wasAway) wakeRef.current();
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
    let stopped = false;

    const poll = async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      const now = Date.now();
      const ping = now - lastPingRef.current > PRESENCE_PING_MS;
      const typing = now - lastTypedRef.current < TYPING_HOLD_MS;
      if (ping || typing) lastPingRef.current = now;
      try {
        const data = await fetchNewMessages(lastIdRef.current, { ping, typing });
        applyIncoming(data.messages);
        setState((prev) => ({
          ...prev,
          online: data.online.filter((p) => p.userId !== userId),
          typing: data.typing.filter((p) => p.userId !== userId),
          offline: false,
        }));
        // В чате что-то происходит — держим частый опрос. В тишине плавно
        // замедляемся, чтобы не жечь вызовы функции на пустых ответах.
        if (data.messages.length || data.typing.some((p) => p.userId !== userId)) {
          intervalRef.current = LIVE_INTERVAL;
        } else {
          intervalRef.current = Math.min(QUIET_INTERVAL, intervalRef.current * SLOWDOWN_STEP);
        }
      } catch {
        // Сеть моргнула — показываем это в шапке и ждём следующего круга.
        setState((prev) => (prev.offline ? prev : { ...prev, offline: true }));
      } finally {
        pollingRef.current = false;
      }
    };

    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, delay);
    };

    const tick = async () => {
      if (stopped) return;
      // Вкладка свёрнута — не спрашиваем вообще: человек всё равно не увидит.
      // Вернётся на вкладку — сработает обработчик ниже и догрузит пропущенное.
      if (!document.hidden) await poll();
      if (stopped) return;
      const idle = Date.now() - lastActivityRef.current > IDLE_AFTER;
      const base = document.hidden || idle ? IDLE_INTERVAL : intervalRef.current;
      // Ночью (с 24:00 до 5:00) опрос замедляется: производство не работает, и чат,
      // забытый открытым на планшете, не должен всю ночь дёргать сервер.
      schedule(withNightSlowdown(base));
    };

    // Разбудить опрос немедленно: отправили сообщение, начали печатать, вернулись
    // на вкладку. Ждать конца текущей паузы в такие моменты — значит показывать
    // ответ собеседника с задержкой ровно там, где она заметнее всего.
    wakeRef.current = () => {
      lastActivityRef.current = Date.now();
      intervalRef.current = LIVE_INTERVAL;
      schedule(0);
    };

    timer = window.setTimeout(tick, withNightSlowdown(LIVE_INTERVAL));
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      wakeRef.current = () => {};
    };
  }, [applyIncoming, userId]);

  // Вернулись на вкладку — сразу подтягиваем всё, что пришло, пока её не смотрели.
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden) return;
      wakeRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, []);

  /**
   * Человек печатает.
   *
   * Наружу уходит не отдельным запросом, а флажком в ближайшем опросе новых
   * сообщений: собеседник увидит «печатает...» через пару секунд, а число
   * обращений к серверу не изменится вовсе.
   */
  const notifyTyping = useCallback(() => {
    const first = Date.now() - lastTypedRef.current > TYPING_HOLD_MS;
    lastTypedRef.current = Date.now();
    lastActivityRef.current = Date.now();
    goLive();
    // Начал печатать после паузы — не ждём конца замедленного круга, иначе
    // «печатает...» появится у собеседника через двадцать секунд, когда человек
    // уже отправил сообщение.
    if (first) wakeRef.current();
  }, [goLive]);

  /**
   * Отправляет сообщение.
   *
   * Сообщение появляется в ленте сразу, ещё до ответа сервера: в цехе связь
   * проседает, и ждать секунду с пустым экраном — значит нажимать «отправить»
   * второй раз. Если отправка не удалась, сообщение остаётся на месте помеченным
   * как недоставленное, и его можно повторить одной кнопкой, не набирая заново.
   */
  const send = useCallback(
    async (text: string, authorName: string) => {
      const value = text.trim();
      if (!value) return;
      const localId = localIdSeq;
      localIdSeq -= 1;
      const draft: ChatMessage = {
        id: localId,
        userId: userId ?? 0,
        userName: authorName,
        text: value,
        createdAt: new Date().toISOString(),
        avatarUrl: me?.avatarUrl ?? null,
        status: 'sending',
      };
      setState((prev) => ({ ...prev, messages: [...prev.messages, draft] }));
      lastTypedRef.current = 0;

      try {
        const saved = await sendMessage(value);
        setState((prev) => ({
          ...prev,
          // Черновик заменяем настоящим сообщением. Если опрос успел принести его
          // раньше нас, черновик просто убираем — дубля в ленте не будет.
          messages: prev.messages.some((m) => m.id === saved.id)
            ? prev.messages.filter((m) => m.id !== localId)
            : prev.messages.map((m) => (m.id === localId ? saved : m)),
        }));
        if (saved.id > lastIdRef.current) lastIdRef.current = saved.id;
        // Написали — скорее всего, сейчас ответят. Возвращаемся к частому опросу.
        wakeRef.current();
      } catch (e) {
        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((m) => (m.id === localId ? { ...m, status: 'failed' } : m)),
        }));
        throw e;
      }
    },
    [me?.avatarUrl, userId],
  );

  /** Повторная отправка недоставленного сообщения — тем же текстом, без перенабора. */
  const retry = useCallback(
    async (localId: number) => {
      const failed = state.messages.find((m) => m.id === localId);
      if (!failed) return;
      setState((prev) => ({
        ...prev,
        messages: prev.messages.map((m) => (m.id === localId ? { ...m, status: 'sending' } : m)),
      }));
      try {
        const saved = await sendMessage(failed.text);
        setState((prev) => ({
          ...prev,
          messages: prev.messages.some((m) => m.id === saved.id)
            ? prev.messages.filter((m) => m.id !== localId)
            : prev.messages.map((m) => (m.id === localId ? saved : m)),
        }));
        if (saved.id > lastIdRef.current) lastIdRef.current = saved.id;
      } catch (e) {
        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((m) => (m.id === localId ? { ...m, status: 'failed' } : m)),
        }));
        throw e;
      }
    },
    [state.messages],
  );

  const hide = useCallback(async (id: number) => {
    // Недоставленное сообщение живёт только в браузере — сервер о нём не знает.
    if (id < 0) {
      setState((prev) => ({ ...prev, messages: prev.messages.filter((m) => m.id !== id) }));
      return;
    }
    await hideMessage(id);
    setState((prev) => ({ ...prev, messages: prev.messages.filter((m) => m.id !== id) }));
  }, []);

  const loadOlder = useCallback(async () => {
    // История подгружается и кнопкой, и прокруткой к верху ленты — без этого замка
    // одно движение пальцем по планшету запускало бы сразу несколько запросов.
    if (loadingOlderRef.current || !state.hasMore) return;
    const oldest = state.messages.find((m) => m.id > 0);
    if (!oldest) return;
    loadingOlderRef.current = true;
    setState((prev) => ({ ...prev, loadingOlder: true }));
    try {
      const data = await fetchOlderMessages(oldest.id);
      setState((prev) => ({
        ...prev,
        messages: [...data.messages, ...prev.messages],
        hasMore: data.hasMore,
      }));
    } finally {
      loadingOlderRef.current = false;
      setState((prev) => ({ ...prev, loadingOlder: false }));
    }
  }, [state.hasMore, state.messages]);

  /**
   * Ставит себе фото прямо из чата.
   *
   * Новая ссылка тут же подставляется во ВСЕ сообщения автора: человек меняет фото,
   * чтобы его узнавали в переписке, — значит, результат должен быть виден в самой
   * переписке, а не после перезагрузки страницы.
   */
  const setMyAvatar = useCallback(
    async (base64: string | null) => {
      setSavingAvatar(true);
      try {
        const result = await saveOwnAvatar(base64);
        setMe((prev) => (prev ? { ...prev, ...result } : prev));
        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.userId === userId ? { ...m, avatarUrl: result.avatarUrl } : m,
          ),
        }));
        return result;
      } finally {
        setSavingAvatar(false);
      }
    },
    [userId],
  );

  return {
    ...state,
    me,
    savingAvatar,
    send,
    retry,
    hide,
    loadOlder,
    notifyTyping,
    setMyAvatar,
  };
};

export default useChat;
