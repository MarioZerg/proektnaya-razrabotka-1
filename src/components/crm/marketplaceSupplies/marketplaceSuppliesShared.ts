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
/**
 * Статус отправления НА САМОЙ ПЛОЩАДКЕ — по нему видно, куда движется товар:
 * в отгрузку или в отмену. Кладовщику важно заметить отмену как можно раньше,
 * пока вещь не уехала в коробе.
 */
export const mpStatusLabels: Record<string, { label: string; tone: 'ok' | 'wait' | 'bad' }> = {
  awaiting_packaging: { label: 'Ждёт сборки', tone: 'wait' },
  awaiting_approve: { label: 'Ждёт подтверждения', tone: 'wait' },
  awaiting_registration: { label: 'Ждёт регистрации', tone: 'wait' },
  awaiting_deliver: { label: 'Готов к отгрузке', tone: 'ok' },
  acceptance_in_progress: { label: 'Приёмка на складе', tone: 'ok' },
  delivering: { label: 'В доставке', tone: 'ok' },
  driver_pickup: { label: 'Забрал курьер', tone: 'ok' },
  delivered: { label: 'Доставлен', tone: 'ok' },
  cancelled: { label: 'ЗАКАЗ ОТМЕНЁН', tone: 'bad' },
  canceled: { label: 'ЗАКАЗ ОТМЕНЁН', tone: 'bad' },
  not_accepted: { label: 'Не принят складом', tone: 'bad' },
  arbitration: { label: 'Спор с площадкой', tone: 'bad' },
  CANCELLED: { label: 'ЗАКАЗ ОТМЕНЁН', tone: 'bad' },
  PROCESSING: { label: 'В обработке', tone: 'wait' },
  DELIVERY: { label: 'В доставке', tone: 'ok' },
  DELIVERED: { label: 'Доставлен', tone: 'ok' },
};

/** Человеческое название статуса площадки. Незнакомый код показываем как есть. */
export const mpStatusInfo = (raw?: string | null) => {
  if (!raw) return null;
  const known = mpStatusLabels[raw] || mpStatusLabels[raw.toLowerCase()];
  if (known) return known;
  if (raw.toLowerCase().includes('cancel')) {
    return { label: 'ЗАКАЗ ОТМЕНЁН', tone: 'bad' as const };
  }
  return { label: raw, tone: 'wait' as const };
};
