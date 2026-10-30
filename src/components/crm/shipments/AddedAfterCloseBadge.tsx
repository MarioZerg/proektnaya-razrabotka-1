import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/dateUtils';
import type { ShipmentItem } from '@/lib/shipmentsApi';

/**
 * Отметка «Довнесён»: рулон добавил администратор уже после принятия приёмки.
 * Бухгалтеру и кладовщику сразу видно, какой рулон пришёл не с основной разгрузкой.
 */
const AddedAfterCloseBadge = ({ item }: { item: ShipmentItem }) => {
  if (!item.addedAfterCloseAt) return null;
  const who = item.addedAfterCloseBy ? `${item.addedAfterCloseBy}, ` : '';
  return (
    <Badge
      className="border-violet-300 bg-violet-100 text-violet-800 hover:bg-violet-100"
      title={`Довнесён после принятия: ${who}${formatDateTime(item.addedAfterCloseAt)}`}
    >
      Довнесён {formatDateTime(item.addedAfterCloseAt)}
      {item.addedAfterCloseBy ? ` · ${item.addedAfterCloseBy}` : ''}
    </Badge>
  );
};

export default AddedAfterCloseBadge;
