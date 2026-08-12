import type { Workshop } from '@/lib/workshopsApi';

export { formatDateTime as formatDate } from '@/lib/dateUtils';

export const statusVariant: Record<string, 'secondary' | 'default' | 'outline'> = {
  Новый: 'secondary',
  Отправлено: 'default',
  Получено: 'outline',
};

export const shiftLabel = (
  workshops: Workshop[],
  workshopId?: number | null,
  shiftNumber?: number | null
) => {
  if (!shiftNumber) return '—';
  const w = workshops.find((wk) => wk.id === workshopId);
  return w?.shiftNames?.[shiftNumber - 1] || `Смена № ${shiftNumber}`;
};