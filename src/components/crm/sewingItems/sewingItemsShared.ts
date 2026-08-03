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
];

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