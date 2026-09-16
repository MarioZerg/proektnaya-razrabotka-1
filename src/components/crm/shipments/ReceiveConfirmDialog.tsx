import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { ShipmentDetail } from '@/lib/shipmentsApi';
import { formatQuantity } from '@/lib/formatQuantity';

interface ReceiveConfirmDialogProps {
  shipment: ShipmentDetail | null;
  onOpenChange: (open: boolean) => void;
  saving: boolean;
  onAccept: () => void;
  onReject: (reason: string) => Promise<void>;
}

// Перед подтверждением приёма сотрудник цеха видит полный состав заявки (рулоны с
// номерами, погонными метрами/штуками и общее число рулонов) и проверяет его — только
// после этого нажимает "Принять" или "Отказать" (с обязательным указанием причины).
const ReceiveConfirmDialog = ({ shipment, onOpenChange, saving, onAccept, onReject }: ReceiveConfirmDialogProps) => {
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const close = (open: boolean) => {
    if (!open) {
      setRejecting(false);
      setRejectReason('');
    }
    onOpenChange(open);
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    await onReject(rejectReason.trim());
    setRejecting(false);
    setRejectReason('');
  };

  if (!shipment) return null;

  const rolls = shipment.items.filter((i) => i.rollId !== null);

  return (
    <Dialog open={!!shipment} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Приём заявки #{shipment.id} в цехе</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Проверьте состав перед подтверждением: {rolls.length}{' '}
            {rolls.length === 1 ? 'рулон' : 'рулонов'}
            {rolls.length > 0
              ? ` · ${formatQuantity(rolls.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0))} ${rolls[0]?.unit || ''}`
              : ''}
            .
          </p>

          {rolls.length === 0 ? (
            <p className="text-sm text-muted-foreground">В заявке нет рулонов</p>
          ) : (
            <div className="min-w-0 overflow-hidden rounded-md border border-border">
              <Table className="min-w-0 table-fixed">
                <TableHeader>
                  <TableRow className="bg-primary hover:bg-primary">
                    <TableHead className="w-[34%] whitespace-normal text-primary-foreground">Рулон</TableHead>
                    <TableHead className="w-[40%] whitespace-normal text-primary-foreground">Материал</TableHead>
                    <TableHead className="w-[26%] whitespace-normal text-primary-foreground">Кол-во</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rolls.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="whitespace-normal break-all font-mono-tech">{i.rollBarcode}</TableCell>
                      <TableCell className="whitespace-normal break-words">{i.materialName}</TableCell>
                      <TableCell className="whitespace-normal">
                        {formatQuantity(i.quantity)} {i.unit}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!rejecting ? (
            <div className="flex gap-2">
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => setRejecting(true)}
                disabled={saving}
              >
                <Icon name="X" size={16} className="mr-2" />
                Отказать
              </Button>
              <Button className="flex-1" onClick={onAccept} disabled={saving || rolls.length === 0}>
                {saving ? 'Сохранение...' : (
                  <>
                    <Icon name="Check" size={16} className="mr-2" />
                    Принять
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Что именно не так? (обязательно)</Label>
              <Textarea
                autoFocus
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Например: не хватает 1 рулона"
                rows={2}
              />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setRejecting(false)} disabled={saving}>
                  Отмена
                </Button>
                <Button
                  variant="destructive"
                  className="flex-1"
                  onClick={handleReject}
                  disabled={saving || !rejectReason.trim()}
                >
                  {saving ? 'Отправка...' : 'Подтвердить отказ'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Заявка останется у кладовщика до внесения исправлений — не пропадёт из списка.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReceiveConfirmDialog;