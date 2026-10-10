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
import { lifeFromRepairPiece } from '@/lib/goodsLifeTimeline';
import GoodsLifeTimeline from '@/components/crm/goodsWarehouse/GoodsLifeTimeline';
import StatusBadge from '@/components/crm/repairFabric/RepairStatusBadge';

interface RepairPieceTableProps {
  visible: RepairPiece[];
  isAdmin: boolean;
  writingOff: number | null;
  deleting: number | null;
  handleWriteOff: (piece: RepairPiece) => void;
  handleDelete: (piece: RepairPiece) => void;
}

const RepairPieceTable = ({
  visible,
  isAdmin,
  writingOff,
  deleting,
  handleWriteOff,
  handleDelete,
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
          {isAdmin && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {visible.map((p) => (
          <TableRow key={p.id}>
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
            <TableCell className="text-sm text-muted-foreground">
              {formatDateTime(p.createdAt)}
              <div className="mt-1">
                <GoodsLifeTimeline events={lifeFromRepairPiece(p)} compact />
              </div>
            </TableCell>
            {isAdmin && (
              <TableCell className="text-sm">
                {p.usedOrderNumber ? (
                  <span className="font-mono-tech">{p.usedOrderNumber}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
                {p.usedByName && (
                  <span className="block text-xs text-muted-foreground">
                    {p.usedByName}
                  </span>
                )}
              </TableCell>
            )}
            {isAdmin && (
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {/* СПИСАТЬ — кусок был и испортился, след остаётся.
                      Раскроенный списывать нечего: ткань уже в вещи. */}
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
                  {/* УДАЛИТЬ СТРОКУ — для мусора: ошибочная отправка,
                      дубль, неверные размеры. Израсходованный кусок не
                      трогаем: он уже вшит в заказ, и без него расход
                      этого заказа перестанет сходиться. */}
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
