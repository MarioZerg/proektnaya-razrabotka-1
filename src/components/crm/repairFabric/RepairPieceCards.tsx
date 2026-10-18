import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { formatDateTime } from '@/lib/dateUtils';
import type { RepairPiece } from '@/lib/repairFabricApi';
import StatusBadge from '@/components/crm/repairFabric/RepairStatusBadge';
import RemovalRequestNote from '@/components/crm/repairFabric/RemovalRequestNote';

interface RepairPieceCardsProps {
  visible: RepairPiece[];
  isAdmin: boolean;
  writingOff: number | null;
  deleting: number | null;
  handleWriteOff: (piece: RepairPiece) => void;
  handleDelete: (piece: RepairPiece) => void;
  onOpen: (piece: RepairPiece) => void;
  canRequestRemoval?: boolean;
  onRequestRemoval?: (piece: RepairPiece) => void;
}

const RepairPieceCards = ({
  visible,
  isAdmin,
  writingOff,
  deleting,
  handleWriteOff,
  handleDelete,
  onOpen,
  canRequestRemoval,
  onRequestRemoval,
}: RepairPieceCardsProps) => (
  <>
    {/* Мобильные карточки: в цехе смотрят с телефона, таблица там не читается. */}
    <div className="space-y-2 md:hidden">
      {visible.map((p) => (
        <div
          key={p.id}
          role="button"
          tabIndex={0}
          className="cursor-pointer rounded-lg border border-border p-3 transition-colors hover:bg-muted/40 active:bg-muted/60"
          onClick={() => onOpen(p)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpen(p);
            }
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {p.barcode && (
                <p className="font-mono-tech font-bold text-violet-900">{p.barcode}</p>
              )}
              <p className="font-semibold">
                {p.material} {p.width}×{p.height}
              </p>
              {p.reasonLabel && (
                <p className="text-xs font-medium text-amber-800">{p.reasonLabel}</p>
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
              {p.removalRequest && <RemovalRequestNote request={p.removalRequest} compact />}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <StatusBadge status={p.status} />
              <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                История
                <Icon name="ChevronRight" size={12} />
              </span>
            </div>
          </div>
          {p.usedOrderNumber && (
            <p className="mt-1 text-xs text-muted-foreground">
              {p.status === 'reserved' ? 'Закреплён за заказом ' : 'Ушёл на заказ '}
              {p.usedOrderNumber}
            </p>
          )}
          {!isAdmin &&
            canRequestRemoval &&
            onRequestRemoval &&
            !p.removalRequest &&
            ['available', 'reserved', 'incoming'].includes(p.status) && (
              <div
                className="mt-2"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => onRequestRemoval(p)}
                >
                  <Icon name="MessageSquareWarning" size={14} className="mr-1.5" />
                  Отправить на удаление
                </Button>
              </div>
            )}
          {isAdmin && p.status !== 'used' && (
            <div
              className="mt-2 flex gap-2"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
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
