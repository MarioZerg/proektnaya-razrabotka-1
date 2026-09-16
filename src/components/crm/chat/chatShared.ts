import type { ChatMessage, ChatPresenceUser } from '@/lib/chatApi';
import { formatTime } from '@/lib/dateUtils';

/** Сколько символов принимает сервер в одном сообщении. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Отбивка «Сегодня / Вчера / дата» между сообщениями разных дней. */
export const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Сегодня';
  if (same(d, yesterday)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', timeZone: 'Europe/Moscow' });
};

// Время сообщений — московское, единое для всей системы: цех, склад и офис должны
// видеть одни и те же часы независимо от настроек своего устройства.
export const timeOnly = (iso: string) => formatTime(iso);

/** «Привезенцева Елена Александровна» -> «Елена»: в чате обращаются по имени. */
export const firstName = (fullName: string) => {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  // В системе ФИО пишут «Фамилия Имя Отчество», поэтому имя — второе слово.
  return parts[1] || parts[0] || 'Сотрудник';
};

/** Сколько времени подряд идущие сообщения одного автора считаем одной репликой. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Продолжает ли сообщение предыдущую реплику того же человека.
 *
 * Когда человек пишет три сообщения подряд, повторять его фото и имя над каждым
 * незачем: лента превращается в лестницу из одинаковых подписей, и читать её
 * тяжелее, чем сплошной текст.
 */
export const continuesGroup = (message: ChatMessage, previous?: ChatMessage): boolean => {
  if (!previous) return false;
  if (previous.userId !== message.userId) return false;
  if (dayLabel(previous.createdAt) !== dayLabel(message.createdAt)) return false;
  const gap = new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return gap >= 0 && gap < GROUP_WINDOW_MS;
};

/** «Елена печатает...», «Елена и Наташа печатают...», «3 человека печатают...» */
export const typingText = (people: ChatPresenceUser[]): string => {
  const names = people.map((p) => firstName(p.userName));
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} печатает`;
  if (names.length === 2) return `${names[0]} и ${names[1]} печатают`;
  return `${names.length} человека печатают`;
};

/** «3 сотрудника в чате» — с правильным окончанием. */
export const onlineText = (count: number): string => {
  const last = count % 10;
  const twoLast = count % 100;
  if (twoLast >= 11 && twoLast <= 14) return `${count} сотрудников в чате`;
  if (last === 1) return `${count} сотрудник в чате`;
  if (last >= 2 && last <= 4) return `${count} сотрудника в чате`;
  return `${count} сотрудников в чате`;
};

/** «2 новых сообщения» — для кнопки возврата к концу ленты. */
export const unreadText = (count: number): string => {
  const last = count % 10;
  const twoLast = count % 100;
  if (twoLast >= 11 && twoLast <= 14) return `${count} новых сообщений`;
  if (last === 1) return `${count} новое сообщение`;
  if (last >= 2 && last <= 4) return `${count} новых сообщения`;
  return `${count} новых сообщений`;
};

/**
 * Разбирает текст на обычные куски и ссылки.
 *
 * В чате постоянно кидают ссылки на кабинет маркетплейса и на заказ. Ссылка
 * простым текстом заставляет человека выделять её и копировать руками — на
 * планшете это отдельное упражнение.
 */
export const splitLinks = (text: string): { text: string; href?: string }[] => {
  const parts: { text: string; href?: string }[] = [];
  const pattern = /(https?:\/\/[^\s<>"']+)/g;
  let last = 0;
  let match = pattern.exec(text);
  while (match) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    // Точка или запятая в конце фразы — это знак препинания, а не часть адреса.
    const raw = match[1].replace(/[.,;:!?)]+$/, '');
    parts.push({ text: raw, href: raw });
    const tailStart = match.index + raw.length;
    last = tailStart;
    pattern.lastIndex = match.index + match[1].length;
    match = pattern.exec(text);
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
};
