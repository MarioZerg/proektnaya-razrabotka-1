import type { Workshop } from '@/lib/workshopsApi';

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

export const statusVariant: Record<string, 'secondary' | 'default' | 'outline'> = {
  Новый: 'secondary',
  Отправлено: 'default',
  Получено: 'outline',
};

export const shiftLabel = (
  workshops: Workshop[],
  workshopId: number | null,
  shiftNumber: number | null
) => {
  if (!shiftNumber) return '—';
  const w = workshops.find((wk) => wk.id === workshopId);
  return w?.shiftNames?.[shiftNumber - 1] || `Смена № ${shiftNumber}`;
};
