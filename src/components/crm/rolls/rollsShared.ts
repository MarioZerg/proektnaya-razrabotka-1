import type { RollStatus } from '@/lib/rollsApi';

export const statusLabels: Record<
  RollStatus,
  { label: string; variant: 'secondary' | 'default' | 'outline' }
> = {
  in_storage: { label: 'На складе', variant: 'secondary' },
  in_workshop: { label: 'В цехе', variant: 'default' },
  completed: { label: 'Завершён', variant: 'outline' },
};

/** Подпись статуса с запасным вариантом.
 *
 * Раньше обращались к словарю напрямую, и один неизвестный статус (такие приходят
 * при переносе данных из другой системы) ронял всю страницу с ошибкой. Теперь
 * незнакомое значение показывается как есть, а список остаётся рабочим. */
export const rollStatusLabel = (status: string) =>
  statusLabels[status as RollStatus] || { label: status, variant: 'outline' as const };
