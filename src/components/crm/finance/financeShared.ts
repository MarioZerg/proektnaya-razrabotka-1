export { formatDate, formatDateTime } from '@/lib/dateUtils';

export const formatMoney = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const accrualTypeLabels: Record<string, string> = {
  cutter_cut: 'Раскрой',
  sewer_piece: 'Пошив',
  packer_stickering: 'Стикеровка',
  packer_repack: 'Перепаковка возврата',
  storekeeper_shift: 'Оклад за смену',
  cleaner_shift: 'Оклад за смену',
  admin_daily: 'Оклад за день',
  manual: 'Ручное начисление',
  penalty: 'Штраф',
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