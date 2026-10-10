import { Badge } from '@/components/ui/badge';
import type { RepairPieceStatus } from '@/lib/repairFabricApi';

/**
 * Состояние куска одним значком.
 *
 * «Под заказ» — отдельное состояние, а не разновидность «израсходован»:
 * ткань ещё цела и её можно вернуть в цех, просто закройщица отложила её
 * под конкретную вещь. Раньше такого состояния не было вовсе, и кусок,
 * который только взяли в руки, уже числился потраченным.
 */
const StatusBadge = ({ status }: { status: RepairPieceStatus }) => {
  if (status === 'incoming') {
    return <Badge className="bg-amber-500 text-white hover:bg-amber-500">Ждёт кладовщика</Badge>;
  }
  if (status === 'available') {
    return <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">В цехе</Badge>;
  }
  if (status === 'reserved') {
    return <Badge className="bg-violet-600 text-white hover:bg-violet-600">Под заказ</Badge>;
  }
  if (status === 'used') return <Badge variant="secondary">Израсходован</Badge>;
  return <Badge variant="destructive">Списан</Badge>;
};

export default StatusBadge;
