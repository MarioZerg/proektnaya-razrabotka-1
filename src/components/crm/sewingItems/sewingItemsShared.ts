import type { SewingStatus } from '@/lib/ordersApi';

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

export const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const timeAgo = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (days > 0) return `${days} дн. ${remHours} час. назад`;
  return `${hours} час. назад`;
};