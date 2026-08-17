export { formatDate, formatDateTime } from '@/lib/dateUtils';
import { formatTime } from '@/lib/dateUtils';

export const formatMoney = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const accrualTypeLabels: Record<string, string> = {
  cutter_cut: 'Раскрой',
  sewer_piece: 'Пошив',
  packer_stickering: 'Стикеровка',
  packer_repack: 'Перепаковка возврата',
  storekeeper_shift: 'Оклад за смену',
  senior_storekeeper_shift: 'Оклад за смену',
  cleaner_shift: 'Оклад за смену',
  admin_daily: 'Оклад за день',
  manual: 'Ручное начисление',
  penalty: 'Штраф',
  /** Премия за выработку по итогам месяца (бонусная программа швей). */
  bonus: 'Бонус',
};

/**
 * Подпись смены, за которую начислен оклад: «Цех №2, смена №1, с 08:15».
 *
 * Нужна, чтобы при двух сменах за день (своя и гостевая в чужом цехе) было видно,
 * за какую именно смену заплачено — и что оклад начислен один раз, а не дважды.
 * У сдельных начислений (раскрой, пошив, стикеровка) смены нет — вернётся пустая строка.
 */
export const formatAccrualShift = (a: {
  shiftWorkshopName?: string | null;
  shiftNumber?: number | null;
  shiftOpenedAt?: string | null;
}): string => {
  if (!a.shiftWorkshopName) return '';
  const parts = [a.shiftWorkshopName];
  if (a.shiftNumber != null) parts.push(`смена №${a.shiftNumber}`);
  if (a.shiftOpenedAt) {
    // Время смены показываем по Москве, как и везде в системе: без указания зоны
    // браузер брал бы часы устройства, и у сотрудника в другом регионе начисление
    // выглядело бы привязанным к чужой смене.
    parts.push(`с ${formatTime(a.shiftOpenedAt)}`);
  }
  return parts.join(', ');
};

export const roleRateLabels: Record<string, string> = {
  cutter: 'Закройщик — за пог.м. по материалу',
  sewer: 'Швея — за штуку по ширине',
  packer: 'Упаковщик — за пог.м. на стикеровке',
  packer_repack: 'Упаковщик — за штуку на перепаковке возвратов',
  storekeeper: 'Кладовщик — оклад за смену',
  senior_storekeeper: 'Старший кладовщик — оклад за смену',
  cleaner: 'Уборщица — оклад за смену',
  admin: 'Администратор — оклад за день',
};