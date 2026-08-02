export const formatMoney = (n: number) =>
  n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

export const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const accrualTypeLabels: Record<string, string> = {
  cutter_cut: 'Раскрой',
  sewer_piece: 'Пошив',
  packer_stickering: 'Стикеровка',
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
  storekeeper: 'Кладовщик — оклад за смену',
  cleaner: 'Уборщица — оклад за смену',
  admin: 'Администратор — оклад за день',
};
