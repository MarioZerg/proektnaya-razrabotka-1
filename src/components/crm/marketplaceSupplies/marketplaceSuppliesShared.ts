export { formatDateTime } from '@/lib/dateUtils';

export const marketplaceLogo: Record<string, { label: string; className: string }> = {
  OZON: { label: 'OZON', className: 'text-[#005BFF] font-bold' },
  WB: { label: 'Wildberries', className: 'text-[#CB11AB] font-bold' },
  Yandex: { label: 'Яндекс.Маркет', className: 'text-[#FFCC00] font-bold' },
};

export const statusVariant: Record<string, { className: string }> = {
  Открытая: { className: 'bg-slate-500 text-white hover:bg-slate-500' },
  'На сборке': { className: 'bg-sky-500 text-white hover:bg-sky-500' },
  Отгрузка: { className: 'bg-amber-500 text-white hover:bg-amber-500' },
  Выполнена: { className: 'bg-emerald-600 text-white hover:bg-emerald-600' },
};

export const candidateStatusVariant = (status: string): 'secondary' | 'default' | 'outline' => {
  if (status === 'Новый') return 'secondary';
  if (status === 'На поставку') return 'default';
  if (status.startsWith('В коробе')) return 'default';
  return 'outline';
};

export const readFileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

/** Форматирует длительность в виде «2 ч 15 мин» (или «45 мин», если меньше часа). */
export { formatDuration } from '@/lib/dateUtils';