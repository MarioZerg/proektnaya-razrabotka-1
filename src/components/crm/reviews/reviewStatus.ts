/** Статус заказа из отзыва WB → короткая подпись для цеха. */
export const wbOrderStatusLabel = (status?: string | null): string | null => {
  switch ((status || '').trim()) {
    case 'buyout':
      return 'У клиента';
    case 'returned':
      return 'Вернули';
    case 'rejected':
      return 'Отказ';
    case 'notSpecified':
      return null;
    default:
      return null;
  }
};

export const wbOrderStatusClass = (status?: string | null): string => {
  switch ((status || '').trim()) {
    case 'buyout':
      return 'bg-emerald-100 text-emerald-800';
    case 'returned':
      return 'bg-amber-100 text-amber-900';
    case 'rejected':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-muted text-muted-foreground';
  }
};
