export interface ItemRow {
  materialId: string;
  quantity: string;
  numberRolls: string;
}

export const emptyRow: ItemRow = { materialId: '', quantity: '', numberRolls: '' };

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

export const statusVariant: Record<string, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  Новый: 'secondary',
  Завершено: 'default',
  Отклонена: 'destructive',
};
