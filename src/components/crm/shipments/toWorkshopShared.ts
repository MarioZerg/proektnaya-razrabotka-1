import type { Workshop } from '@/lib/workshopsApi';

export { formatDateTime as formatDate } from '@/lib/dateUtils';

/**
 * Цвет статуса заявки в цех.
 *
 * Кладовщик смотрит на длинный список и ищет глазами свою работу, а не читает подписи.
 * Поэтому цвет означает не «красиво», а «чья очередь ходить»:
 *   серый   — заявка только создана, её ещё никто не собирал;
 *   синий   — рулоны отобраны и уехали, ждём, что скажет цех;
 *   зелёный — цех принял, вопрос закрыт.
 *
 * Раньше все три были почти одинаковыми серыми бейджами: «Новый» и «Получено»
 * различались только надписью, и в списке из тридцати заявок работа терялась.
 */
export const statusClass: Record<string, string> = {
  Новый: 'bg-slate-500 text-white hover:bg-slate-500',
  Отправлено: 'bg-sky-500 text-white hover:bg-sky-500',
  Получено: 'bg-emerald-600 text-white hover:bg-emerald-600',
  // Старые записи из первых дней работы системы: по смыслу это «Получено».
  Выполнена: 'bg-emerald-600 text-white hover:bg-emerald-600',
};

/** Заявка вернулась из цеха с отказом — её нужно исправить и отправить заново.
 *  Это единственное состояние, где ждут действия ПРЯМО СЕЙЧАС, поэтому красный. */
export const rejectedClass = 'bg-destructive text-destructive-foreground hover:bg-destructive';

export const statusStyle = (status: string, rejected = false) =>
  rejected ? rejectedClass : statusClass[status] || statusClass.Новый;

export const shiftLabel = (
  workshops: Workshop[],
  workshopId?: number | null,
  shiftNumber?: number | null
) => {
  if (!shiftNumber) return '—';
  const w = workshops.find((wk) => wk.id === workshopId);
  return w?.shiftNames?.[shiftNumber - 1] || `Смена № ${shiftNumber}`;
};