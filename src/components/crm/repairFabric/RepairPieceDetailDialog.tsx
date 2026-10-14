import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Icon from '@/components/ui/icon';
import { formatDateTime } from '@/lib/dateUtils';
import type { RepairPiece } from '@/lib/repairFabricApi';
import { lifeFromRepairPiece } from '@/lib/goodsLifeTimeline';
import GoodsLifeTimeline from '@/components/crm/goodsWarehouse/GoodsLifeTimeline';
import StatusBadge from '@/components/crm/repairFabric/RepairStatusBadge';

interface Props {
  piece: RepairPiece | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  writingOff: number | null;
  deleting: number | null;
  onWriteOff: (piece: RepairPiece) => void;
  onDelete: (piece: RepairPiece) => void;
}

const Fact = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="min-w-0">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-0.5 text-sm font-medium break-words">{value}</p>
  </div>
);

/**
 * Карточка куска: сюда проваливаются из списка, чтобы увидеть понятную историю.
 *
 * В таблице/карточках таймлайн в одну строку не читается — тут полная лента
 * с датой и кем сделано, плюс факты про сам отрез.
 */
const RepairPieceDetailDialog = ({
  piece,
  open,
  onOpenChange,
  isAdmin,
  writingOff,
  deleting,
  onWriteOff,
  onDelete,
}: Props) => {
  if (!piece) return null;

  const events = lifeFromRepairPiece(piece);
  const addedBy =
    piece.addedByRole === 'admin'
      ? 'администратор'
      : piece.addedByRole === 'storekeeper'
        ? 'кладовщик'
        : piece.addedByRole === 'packer'
          ? 'упаковщица'
          : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="shrink-0 space-y-3 border-b border-border px-6 py-4 text-left">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="min-w-0">
              {piece.barcode ? (
                <p className="font-mono-tech text-lg font-bold text-violet-900">
                  {piece.barcode}
                </p>
              ) : null}
              <DialogTitle className="text-xl">
                {piece.material} {piece.width}×{piece.height}
              </DialogTitle>
              {piece.reasonLabel ? (
                <p className="mt-1 text-sm font-medium text-amber-800">{piece.reasonLabel}</p>
              ) : null}
            </div>
            <StatusBadge status={piece.status} />
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Fact label="Добавил" value={piece.createdByName || '—'} />
            <Fact
              label="Когда"
              value={piece.createdAt ? formatDateTime(piece.createdAt) : '—'}
            />
            {addedBy ? <Fact label="Роль" value={addedBy} /> : null}
            {(piece.workshopName || piece.shiftNumber) && (
              <Fact
                label="Цех / смена"
                value={
                  <>
                    {piece.workshopName || '—'}
                    {piece.shiftNumber ? ` · смена ${piece.shiftNumber}` : ''}
                  </>
                }
              />
            )}
            {piece.sourceOrderNumber ? (
              <Fact label="Исходный заказ" value={piece.sourceOrderNumber} />
            ) : null}
            {piece.storageBarcode ? (
              <Fact label="Стикер GW" value={piece.storageBarcode} />
            ) : null}
            {piece.usedOrderNumber ? (
              <Fact
                label={piece.status === 'reserved' ? 'Закреплён за' : 'Ушёл на заказ'}
                value={
                  <>
                    {piece.usedOrderNumber}
                    {piece.usedByName ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {piece.usedByName}
                      </span>
                    ) : null}
                  </>
                }
              />
            ) : null}
            {piece.comment ? <Fact label="Комментарий" value={piece.comment} /> : null}
          </div>

          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Icon name="History" size={16} className="text-muted-foreground" />
              История куска
            </h3>
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <GoodsLifeTimeline events={events} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              От исходного заказа до перешива и раскроя — что было с этим отрезом
            </p>
          </div>
        </div>

        {isAdmin && piece.status !== 'used' && (
          <div className="flex shrink-0 flex-wrap gap-2 border-t border-border px-6 py-3">
            {piece.status !== 'written_off' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onWriteOff(piece)}
                disabled={writingOff === piece.id}
              >
                <Icon name="Ban" size={14} className="mr-1.5" />
                Списать
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(piece)}
              disabled={deleting === piece.id}
            >
              <Icon
                name={deleting === piece.id ? 'Loader2' : 'Trash2'}
                size={14}
                className={`mr-1.5 ${deleting === piece.id ? 'animate-spin' : ''}`}
              />
              Удалить
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RepairPieceDetailDialog;
