import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { RepairPiece } from '@/lib/repairFabricApi';

interface Props {
  piece: RepairPiece | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (piece: RepairPiece, usedInSewing: boolean) => void;
}

/**
 * Удаление куска с выбором, что стало с вещью.
 *
 * Кусок удаляют по двум причинам. Завели по ошибке — вещь возвращается туда,
 * откуда взяли (на перепаковку или в брак). Кусок уже пустили в пошив — ткани
 * больше нет, вещь никуда не возвращается. Раньше вторая ситуация тоже
 * возвращала вещь на перепаковку, и она висела у упаковщицы.
 */
const DeletePieceDialog = ({ piece, busy, onOpenChange, onConfirm }: Props) => {
  const [usedInSewing, setUsedInSewing] = useState(true);
  if (!piece) return null;
  const fromItem = !!piece.goodsWarehouseId;

  const option = (value: boolean, title: string, text: string) => (
    <button
      type="button"
      onClick={() => setUsedInSewing(value)}
      className={`w-full rounded-lg border p-3 text-left transition ${
        usedInSewing === value ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold">
        <Icon name={usedInSewing === value ? 'CircleCheck' : 'Circle'} size={16} />
        {title}
      </span>
      <span className="mt-1 block pl-6 text-xs text-muted-foreground">{text}</span>
    </button>
  );

  return (
    <Dialog open={!!piece} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Удалить кусок {piece.material} {piece.width}×{piece.height}?
          </DialogTitle>
          <DialogDescription>
            Строка пропадёт из таблицы насовсем. Если кусок испортили — используйте списание.
          </DialogDescription>
        </DialogHeader>

        {fromItem ? (
          <div className="space-y-2">
            {option(
              true,
              'Кусок уже использован в пошиве',
              'Ткань израсходована. Вещь никуда не возвращается и не появится у упаковщицы.',
            )}
            {option(
              false,
              'Кусок заведён по ошибке',
              'Вещь вернётся туда, откуда её взяли: на перепаковку или в брак.',
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Кусок заведён вручную, вещи за ним нет.</p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(piece, fromItem && usedInSewing)}
            disabled={busy}
          >
            <Icon name={busy ? 'Loader2' : 'Trash2'} size={14} className={`mr-1.5 ${busy ? 'animate-spin' : ''}`} />
            Удалить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeletePieceDialog;
