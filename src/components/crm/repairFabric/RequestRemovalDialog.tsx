import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import {
  REMOVAL_REASON_LABELS,
  requestPieceRemoval,
  type RepairPiece,
  type RepairRemovalReason,
} from '@/lib/repairFabricApi';

interface Props {
  piece: RepairPiece | null;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}

const REASONS: Array<{ code: RepairRemovalReason; hint: string }> = [
  { code: 'sticker_mismatch', hint: 'Материал или размер на стикере не совпадает с куском' },
  { code: 'defective', hint: 'Дыры, пятна, затяжки — для перешива не годится' },
];

/**
 * Закройщик просит администратора удалить кусок.
 *
 * Сам кусок закройщик не удаляет: это стирает строку из учёта. Просьба
 * уходит администратору во вкладку «Куски на перешив», он решает.
 */
const RequestRemovalDialog = ({ piece, onOpenChange, onSent }: Props) => {
  const { toast } = useToast();
  const [reason, setReason] = useState<RepairRemovalReason | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (piece) {
      setReason(null);
      setComment('');
    }
  }, [piece]);

  const send = async () => {
    if (!piece || !reason) return;
    setSending(true);
    try {
      await requestPieceRemoval(piece.id, reason, comment.trim() || undefined);
      toast({ title: 'Просьба отправлена администратору' });
      onOpenChange(false);
      onSent();
    } catch (e) {
      toast({
        title: 'Не удалось отправить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={!!piece} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Попросить удалить кусок</DialogTitle>
          {piece && (
            <DialogDescription>
              {piece.barcode ? `${piece.barcode} · ` : ''}
              {piece.material} {piece.width}×{piece.height}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-3">
          <Label>Что не так с куском</Label>
          <div className="space-y-2">
            {REASONS.map((r) => (
              <button
                key={r.code}
                type="button"
                onClick={() => setReason(r.code)}
                className={`w-full rounded-lg border-2 p-3 text-left transition ${
                  reason === r.code
                    ? 'border-violet-500 bg-violet-50'
                    : 'border-border hover:border-violet-300'
                }`}
              >
                <p className="font-medium">{REMOVAL_REASON_LABELS[r.code]}</p>
                <p className="text-xs text-muted-foreground">{r.hint}</p>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="removal-comment">Комментарий (необязательно)</Label>
            <Textarea
              id="removal-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Например: на стикере 300×250, а кусок 280×250"
              rows={3}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Отмена
          </Button>
          <Button
            className="bg-violet-600 hover:bg-violet-700"
            onClick={send}
            disabled={!reason || sending}
          >
            <Icon
              name={sending ? 'Loader2' : 'Send'}
              size={16}
              className={`mr-2 ${sending ? 'animate-spin' : ''}`}
            />
            Отправить администратору
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RequestRemovalDialog;
