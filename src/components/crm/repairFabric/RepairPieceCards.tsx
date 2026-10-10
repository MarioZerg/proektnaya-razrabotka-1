import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { formatDateTime } from '@/lib/dateUtils';
import type { RepairPiece } from '@/lib/repairFabricApi';
import { lifeFromRepairPiece } from '@/lib/goodsLifeTimeline';
import GoodsLifeTimeline from '@/components/crm/goodsWarehouse/GoodsLifeTimeline';
import StatusBadge from '@/components/crm/repairFabric/RepairStatusBadge';

interface RepairPieceCardsProps {
  visible: RepairPiece[];
  isAdmin: boolean;
  writingOff: number | null;
  deleting: number | null;
  handleWriteOff: (piece: RepairPiece) => void;
  handleDelete: (piece: RepairPiece) => void;
}

const RepairPieceCards = ({
  visible,
  isAdmin,
  writingOff,
  deleting,
  handleWriteOff,
  handleDelete,
}: RepairPieceCardsProps) => (
  <>
    {/* Мобильные карточки: в цехе смотрят с телефона, таблица там не читается. */}
    <div className="space-y-2 md:hidden">
      {visible.map((p) => (
        <div key={p.id} className="rounded-lg border border-border p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              {p.barcode && (
                <p className="font-mono-tech font-bold text-violet-900">
                  {p.barcode}
                </p>
              )}
              <p className="font-semibold">
                {p.material} {p.width}×{p.height}
              </p>
              {p.reasonLabel && (
                <p className="text-xs font-medium text-amber-800">
                  {p.reasonLabel}
                </p>
              )}
              {(p.addedByRole === 'storekeeper' || p.addedByRole === 'admin') && (
                <p className="text-xs font-medium text-violet-800">
                  {p.addedByRole === 'admin' ? 'Добавил администратор' : 'Добавил кладовщик'}
                </p>
              )}
              {p.sourceOrderNumber && (
                <p className="text-xs text-muted-foreground">заказ {p.sourceOrderNumber}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {p.createdByName || '—'} · {formatDateTime(p.createdAt)}
              </p>
            </div>
            <StatusBadge status={p.status} />
          </div>
          <div className="mt-2">
            <GoodsLifeTimeline events={lifeFromRepairPiece(p)} compact />
          </div>
          {p.usedOrderNumber && (
            <p className="mt-1 text-xs text-muted-foreground">
              {p.status === 'reserved' ? 'Закреплён за заказом ' : 'Ушёл на заказ '}
              {p.usedOrderNumber}
            </p>
          )}
          {/* Удаление доступно и с телефона: админ чаще всего замечает
              ошибочную строку, стоя в цехе, а не за компьютером. */}
          {isAdmin && p.status !== 'used' && (
            <div className="mt-2 flex gap-2">
              {p.status !== 'written_off' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleWriteOff(p)}
                  disabled={writingOff === p.id}
                >
                  <Icon name="Ban" size={14} className="mr-1.5" />
                  Списать
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => handleDelete(p)}
                disabled={deleting === p.id}
              >
                <Icon
                  name={deleting === p.id ? 'Loader2' : 'Trash2'}
                  size={14}
                  className={`mr-1.5 ${deleting === p.id ? 'animate-spin' : ''}`}
                />
                Удалить
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  </>
);

export default RepairPieceCards;
