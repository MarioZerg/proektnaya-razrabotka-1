/** Роль в записи брака — показываем словом, а не кодом. */
export const roleLabels: Record<string, string> = {
  cutter: 'закройщик',
  sewer: 'швея',
  packer: 'упаковщица',
  storekeeper: 'кладовщик',
};

export const formatQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

export const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
