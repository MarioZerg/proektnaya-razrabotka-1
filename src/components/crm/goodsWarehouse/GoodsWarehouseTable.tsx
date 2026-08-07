import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import Icon from '@/components/ui/icon';
import GoodsWarehouseCards from '@/components/crm/goodsWarehouse/GoodsWarehouseCards';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { printStorageSticker } from '@/lib/printStorageSticker';
import { printIndividualSticker } from '@/lib/printIndividualSticker';
import {
  formatDate,
  statusLabels,
  statusVariant,
  reasonLabels,
  reasonIcons,
  reasonClass,
} from '@/components/crm/goodsWarehouse/goodsWarehouseShared';

interface GoodsWarehouseTableProps {
  loading: boolean;
  items: GoodsWarehouseItem[];
  onReturnToWorkshop: (id: number) => void;
  onMarkLost: (id: number, reason: string) => Promise<void>;
}

const GoodsWarehouseTable = ({ loading, items, onReturnToWorkshop, onMarkLost }: GoodsWarehouseTableProps) => {
  const [lostId, setLostId] = useState<number | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [saving, setSaving] = useState(false);

  const openLostDialog = (id: number) => {
    setLostId(id);
    setLostReason('');
  };

  const handleConfirmLost = async () => {
    if (!lostId) return;
    setSaving(true);
    try {
      await onMarkLost(lostId, lostReason.trim());
      setLostId(null);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Товаров не найдено</p>;
  }

  return (
    <>
      {/* На телефоне — карточки, на компьютере привычная таблица. */}
      <div className="md:hidden">
        <GoodsWarehouseCards
          items={items}
          onReturnToWorkshop={onReturnToWorkshop}
          onMarkLost={openLostDialog}
        />
      </div>

      <div className="hidden rounded-md border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="text-primary-foreground">#</TableHead>
              <TableHead className="text-primary-foreground">Номер заказа</TableHead>
              <TableHead className="text-primary-foreground">Товар</TableHead>
              <TableHead className="text-primary-foreground">Статус</TableHead>
              <TableHead className="text-primary-foreground">Откуда</TableHead>
              <TableHead className="text-primary-foreground">Полка</TableHead>
              <TableHead className="text-primary-foreground">Принят</TableHead>
              <TableHead className="text-primary-foreground">Отгружен</TableHead>
              <TableHead className="text-primary-foreground" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Товары, принятые администратором вручную, подсвечены: их не было в заказах
                маркетплейса, по ним может понадобиться отдельная сверка. */}
            {items.map((i) => (
              <TableRow
                key={i.id}
                className={i.receiveReason === 'admin' ? 'bg-violet-50 hover:bg-violet-100' : ''}
              >
                <TableCell>{i.id}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{i.orderNumber || '—'}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() =>
                        // Индивидуальному пошиву — свой стикер с тканью и размерами:
                        // такие вещи опознают на полке по ним, а не по артикулу.
                        i.receiveReason === 'individual'
                          ? printIndividualSticker({
                              orderNumber: i.orderNumber || '',
                              material: i.material,
                              width: i.width,
                              height: i.height,
                              storageBarcode: i.storageBarcode,
                              product: i.product,
                            })
                          : printStorageSticker({
                              storageBarcode: i.storageBarcode,
                              title: i.product,
                              orderNumber: i.orderNumber,
                            })
                      }
                    >
                      <Icon name="Barcode" size={12} />
                    </Button>
                  </div>
                  <div className="font-mono-tech text-xs text-muted-foreground">{i.storageBarcode}</div>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{i.product || '—'}</div>
                  {i.status === 'lost' && i.lostReason && (
                    <div className="text-xs text-destructive">Причина: {i.lostReason}</div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant[i.status]}>{statusLabels[i.status]}</Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    className={`${reasonClass[i.receiveReason] || ''} gap-1 whitespace-nowrap font-normal`}
                  >
                    <Icon name={reasonIcons[i.receiveReason] || 'Hand'} size={12} />
                    {reasonLabels[i.receiveReason] || 'Принят вручную'}
                  </Badge>
                </TableCell>
                <TableCell>{i.shelfName || '—'}</TableCell>
                <TableCell>{formatDate(i.receivedAt)}</TableCell>
                <TableCell>{i.shippedAt ? formatDate(i.shippedAt) : '—'}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    {(i.status === 'in_stock' || i.status === 'picking') && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => onReturnToWorkshop(i.id)}>
                          В цех
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => openLostDialog(i.id)}>
                          <Icon name="HelpCircle" size={14} />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={lostId !== null} onOpenChange={(open) => !open && setLostId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отметить товар утерянным?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Товар выбывает из активных статусов склада. Укажите причину:</p>
                <Textarea
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value)}
                  placeholder="Причина утери"
                  rows={2}
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmLost} disabled={saving || !lostReason.trim()}>
              {saving ? 'Сохранение...' : 'Отметить утерянным'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default GoodsWarehouseTable;