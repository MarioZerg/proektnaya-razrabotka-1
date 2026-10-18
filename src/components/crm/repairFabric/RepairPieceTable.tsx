import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { formatDateTime } from '@/lib/dateUtils';
import type { RepairPiece } from '@/lib/repairFabricApi';
import StatusBadge from '@/components/crm/repairFabric/RepairStatusBadge';
import RemovalRequestNote from '@/components/crm/repairFabric/RemovalRequestNote';

interface RepairPieceTableProps {
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

const canAsk = (p: RepairPiece) =>
  !p.removalRequest && ['available', 'reserved', 'incoming'].includes(p.status);

const RepairPieceTable = ({
  visible,
  isAdmin,
  writingOff,
  deleting,
  handleWriteOff,
  handleDelete,
  onOpen,
  canRequestRemoval,
  onRequestRemoval,
}: RepairPieceTableProps) => (
  <div className="hidden overflow-x-auto md:block">
    <Table>
      <TableHeader>
        <TableRow>
          {/* Номер стикера — первая колонка: именно по нему кусок
              ищут на стеллаже и сверяют с карточкой заказа. */}
          <TableHead>Номер</TableHead>
          <TableHead>Материал</TableHead>
          <TableHead>Размер</TableHead>
          <TableHead>Причина перешива</TableHead>
          <TableHead>Статус</TableHead>
          {isAdmin && <TableHead>Кто отправил</TableHead>}
          {isAdmin && <TableHead>Цех / смена</TableHead>}
          <TableHead>Когда</TableHead>
          {isAdmin && <TableHead>Куда ушёл</TableHead>}
          <TableHead className="w-10" />
          {(isAdmin || canRequestRemoval) && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {visible.map((p) => (
          <TableRow
            key={p.id}
            className="cursor-pointer"
            onClick={() => onOpen(p)}
          >
            <TableCell className="font-mono-tech font-bold text-violet-900">
              {p.barcode || '—'}
            </TableCell>
            <TableCell className="font-medium">{p.material}</TableCell>
            <TableCell className="font-mono-tech">
              {p.width}×{p.height}
            </TableCell>
            <TableCell className="text-sm">
              <div>{p.reasonLabel || <span className="text-muted-foreground">—</span>}</div>
              {(p.addedByRole === 'storekeeper' || p.addedByRole === 'admin') && (
                <span className="mt-0.5 inline-block rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-800">
                  {p.addedByRole === 'admin' ? 'Добавил администратор' : 'Добавил кладовщик'}
                </span>
              )}
              {p.sourceOrderNumber && (
                <div className="text-xs text-muted-foreground">заказ {p.sourceOrderNumber}</div>
              )}
              {p.removalRequest && <RemovalRequestNote request={p.removalRequest} compact />}
            </TableCell>
            <TableCell>
              <StatusBadge status={p.status} />
            </TableCell>
            {isAdmin && <TableCell>{p.createdByName || '—'}</TableCell>}
            {isAdmin && (
              <TableCell className="text-sm text-muted-foreground">
                {p.workshopName || '—'}
                {p.shiftNumber ? ` · смена ${p.shiftNumber}` : ''}
              </TableCell>
            )}
            <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
              {formatDateTime(p.createdAt)}
            </TableCell>
            {isAdmin && (
              <TableCell className="text-sm">
                {p.usedOrderNumber ? (
                  <span className="font-mono-tech">{p.usedOrderNumber}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
                {p.usedByName && (
                  <span className="block text-xs text-muted-foreground">{p.usedByName}</span>
                )}
              </TableCell>
            )}
            <TableCell className="text-muted-foreground">
              <Icon name="ChevronRight" size={16} title="Открыть историю" />
            </TableCell>
            {!isAdmin && canRequestRemoval && (
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                {canAsk(p) && onRequestRemoval && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    title="Попросить администратора удалить кусок"
                    onClick={() => onRequestRemoval(p)}
                  >
                    <Icon name="MessageSquareWarning" size={14} className="mr-1.5" />
                    На удаление
                  </Button>
                )}
              </TableCell>
            )}
            {isAdmin && (
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end gap-1">
                  {(p.status === 'available' || p.status === 'reserved') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Списать: кусок был, но испорчен или потерян"
                      onClick={() => handleWriteOff(p)}
                      disabled={writingOff === p.id}
                    >
                      <Icon
                        name={writingOff === p.id ? 'Loader2' : 'Ban'}
                        size={14}
                        className={writingOff === p.id ? 'animate-spin' : ''}
                      />
                    </Button>
                  )}
                  {p.status !== 'used' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      title="Удалить строку из таблицы насовсем"
                      onClick={() => handleDelete(p)}
                      disabled={deleting === p.id}
                    >
                      <Icon
                        name={deleting === p.id ? 'Loader2' : 'Trash2'}
                        size={14}
                        className={deleting === p.id ? 'animate-spin' : ''}
                      />
                    </Button>
                  )}
                </div>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
);

export default RepairPieceTable;
