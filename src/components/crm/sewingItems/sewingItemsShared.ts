import type { SewingStatus, Marketplace } from '@/lib/ordersApi';

export const widthOptions = ['200', '300', '400', '500', '600', '700', '800'];
export const heightOptions = [
  '220', '225', '230', '235', '240', '245', '250', '255', '260', '265', '270', '275', '280', '285', '290', '295',
];
export const statusOptions: SewingStatus[] = ['Новый', 'На раскрое', 'Раскроено', 'В работе', 'Стикеровка', 'Готовые'];

export interface StatusTab {
  value: SewingStatus;
  label: string;
}

export const statusTabs: StatusTab[] = [
  { value: 'Новый', label: 'Новый' },
  { value: 'На раскрое', label: 'На раскрое' },
  { value: 'В работе', label: 'В работе' },
  { value: 'Раскроено', label: 'Раскроено' },
  { value: 'Стикеровка', label: 'На стикеровке' },
  { value: 'Готовые', label: 'Готовые' },
  { value: 'Со склада', label: 'Со склада' },
];

/**
 * Цвет статуса на конвейере — общий для таблицы (ПК) и карточек (телефон).
 *
 * Цвет читается быстрее текста: в таблице на 50 строк видно с одного взгляда, где
 * работа стоит, а где идёт. Раньше в таблице все статусы были одинаково серыми, и
 * мастеру приходилось вчитываться в каждую строку.
 *
 * Палитра взята из карточек, чтобы один и тот же статус не выглядел по-разному на
 * телефоне и на компьютере. Добавлены недостающие «Со склада» и «Отменён»: они
 * встречаются в таблице, но в карточках их не было — бейдж оставался бесцветным.
 */
export const statusBadgeClass: Record<string, string> = {
  Новый: 'bg-slate-500 text-white hover:bg-slate-500',
  'На раскрое': 'bg-amber-500 text-white hover:bg-amber-500',
  'В работе': 'bg-sky-500 text-white hover:bg-sky-500',
  Раскроено: 'bg-violet-500 text-white hover:bg-violet-500',
  Стикеровка: 'bg-orange-500 text-white hover:bg-orange-500',
  Готовые: 'bg-emerald-600 text-white hover:bg-emerald-600',
  // Заказ закрыт готовой вещью со склада — работа цеха по нему не нужна.
  'Со склада': 'bg-teal-600 text-white hover:bg-teal-600',
  // Отменён покупателем: шить нечего, вещь уходит на хранение.
  Отменён: 'bg-red-600 text-white hover:bg-red-600',
};

export const marketplaceLogo: Record<string, { label: string; className: string }> = {
  OZON: { label: 'OZON', className: 'text-[#005BFF] font-bold' },
  WB: { label: 'Wildberries', className: 'text-[#CB11AB] font-bold' },
  Yandex: { label: 'Яндекс.Маркет', className: 'text-[#FFCC00] font-bold' },
};

export const marketplaceOptions: Marketplace[] = ['OZON', 'WB', 'Yandex'];

/** Сокращает ФИО до "Фамилия И.О." — например "Коротаева Наталья Александровна" → "Коротаева Н.А.". */
export const shortFio = (fullName: string): string => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const [last, first, middle] = parts;
  const initials = [first, middle].filter(Boolean).map((p) => `${p[0].toUpperCase()}.`).join('');
  return initials ? `${last} ${initials}` : last;
};

export { formatDateTime as formatDate, timeAgo } from '@/lib/dateUtils';