import Icon from '@/components/ui/icon';
import { formatDateTime } from '@/lib/dateUtils';
import type { RepairRemovalRequest } from '@/lib/repairFabricApi';

interface Props {
  request: RepairRemovalRequest;
  compact?: boolean;
}

/** Пометка «закройщик просит удалить» — видна, пока администратор не решил. */
const RemovalRequestNote = ({ request, compact }: Props) => (
  <div className="mt-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
    <p className="flex items-center gap-1 font-semibold">
      <Icon name="TriangleAlert" size={12} />
      Просят удалить: {request.reasonLabel}
    </p>
    {!compact && request.comment && <p className="mt-0.5">{request.comment}</p>}
    <p className="mt-0.5 text-red-700/80">
      {request.byName || '—'} · {formatDateTime(request.at)}
    </p>
  </div>
);

export default RemovalRequestNote;
