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
import { zoneDotClass, zoneLabels } from '@/lib/workZone';
import { shortProductName } from '@/lib/shortProductName';
import GoodsWarehouseCards from '@/components/crm/goodsWarehouse/GoodsWarehouseCards';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { printStorageSticker } from '@/lib/printStorageSticker';
import { printIndividualSticker } from '@/lib/printIndividualSticker';
import { printOrderMarketplaceLabel } from '@/lib/printOrderMarketplaceLabel';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  formatDate,
  statusLabels,
  statusVariant,
  statusZone,
  reasonLabels,
  canPrintMarketplaceLabel,
} from '@/components/crm/goodsWarehouse/goodsWarehouseShared';

interface GoodsWarehouseTableProps {
  loading: boolean;
  items: GoodsWarehouseItem[];
  onReturnToWorkshop: (id: number) => void;
  onMarkLost: (id: number, reason: string) => Promise<void>;
  /** Колонка «Действия» видна только администратору. */
  isAdmin?: boolean;
  /** Удаление со склада — только для вещей на хранении и только у администратора. */
  onDelete?: (id: number) => Promise<void>;
}

const GoodsWarehouseTable = ({
  loading,
  items,
  onReturnToWorkshop,
  onMarkLost,
  isAdmin = false,
  onDelete,
}: GoodsWarehouseTableProps) => {
  const [lostId, setLostId] = useState<number | null>(null);
  const [lostReason, setLostReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Какой вещи сейчас тянем ярлык у маркетплейса: он приходит по сети, не мгновенно. */
  const [labelBusyId, setLabelBusyId] = useState<number | null>(null);
  const { toast } = useToast();

  /** Перепечатка ярлыка маркетплейса по вещи, собранной с полки. */
  const { user } = useAuth();
  /**
   * Печатать наклейки из общего списка склада может только старший кладовщик.
   *
   * Обычный кладовщик печатает стикеры там, где реально работает руками: собирает
   * вещь с полки — и сканер сразу выдаёт наклейку. Печать из таблицы — это печать
   * «вслепую», не держа вещь в руках: наклейка уходит не на ту вещь, а старый ярлык
   * остаётся на пакете. Номер стикера ему по-прежнему виден — найти вещь на полке
   * и назвать её он может.
   */
  const canPrintStickers = user?.role === 'senior_storekeeper' || user?.role === 'admin';

  const handlePrintMpLabel = async (i: GoodsWarehouseItem) => {
    if (!i.reservedOrderId) return;
    setLabelBusyId(i.id);
    try {
      await printOrderMarketplaceLabel({
        id: i.reservedOrderId,
        orderNumber: i.reservedOrderNumber || '',
        marketplace: i.marketplace,
        orderType: i.orderType,
      });
    } catch (e) {
      toast({
        title: 'Ярлык не пришёл',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setLabelBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteId || !onDelete) return;
    setDeleting(true);
    try {
      await onDelete(deleteId);
      setDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

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
          onPrintMpLabel={handlePrintMpLabel}
        />
      </div>

      <div className="hidden rounded-md border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="text-primary-foreground">Товар</TableHead>
              <TableHead className="text-primary-foreground">Статус</TableHead>
              <TableHead className="text-primary-foreground">Стикеры</TableHead>
              <TableHead className="text-primary-foreground">№ полки</TableHead>
              <TableHead className="text-primary-foreground">Дата отгрузки</TableHead>
              <TableHead className="text-primary-foreground">Дата возврата</TableHead>
              {isAdmin && <TableHead className="text-primary-foreground">Действия</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Товары, принятые администратором вручную, подсвечены: их не было в заказах
                маркетплейса, по ним может понадобиться отдельная сверка. */}
            {items.map((i) => (
              <TableRow
                key={i.id}
                className={i.receiveReason === 'admin' ? 'bg-amber-50 hover:bg-amber-100' : ''}
              >
                {/* Товар: что за вещь, её размеры и номер заказа — по ним кладовщик
                    опознаёт её на полке. */}
                <TableCell>
                  {/* Коротко: ткань и размер — по ним вещь ищут на полке. Полный
                      заголовок с маркетплейса занимал три строки и прятал главное;
                      он остался в подсказке при наведении. */}
                  <div className="font-medium" title={i.product || ''}>
                    {shortProductName(i)}
                  </div>
                  <div className="text-xs text-muted-foreground">{i.orderNumber || '—'}</div>
                  {i.status === 'lost' && i.lostReason && (
                    <div className="text-xs text-destructive">Причина: {i.lostReason}</div>
                  )}
                </TableCell>
                <TableCell>
                  {/* Цветная точка = чья это работа: фиолетовая — цех, зелёная —
                      склад, двухцветная — момент передачи между ними. */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${zoneDotClass[statusZone[i.status]]}`}
                      title={zoneLabels[statusZone[i.status]]}
                    />
                    <Badge variant={statusVariant[i.status]}>{statusLabels[i.status]}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {reasonLabels[i.receiveReason] || 'Принят вручную'}
                  </div>
                </TableCell>
                {/* Стикер хранения: номер и кнопка перепечатать, если наклейка потерялась. */}
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono-tech text-xs">{i.storageBarcode}</span>
                    {canPrintStickers && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      title="Напечатать стикер хранения"
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
                    )}

                    {/* ПЕРЕпечатка ярлыка маркетплейса — только для вещей, которые уже
                        застикерованы и отправлены на поставку. Наклейку могли порвать
                        при укладке в короб, и тогда её печатают отсюда.
                        Вещи из подбора («На сборке») сюда не попадают: их стикеруют
                        сканером, держа вещь в руках, и второй ярлык на то же
                        отправление привёл бы к путанице на складе. */}
                    {canPrintStickers && canPrintMarketplaceLabel(i) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        title={`Напечатать ярлык ${(i.marketplace || 'маркетплейса').toUpperCase()} по заказу ${i.reservedOrderNumber || ''}`}
                        disabled={labelBusyId === i.id}
                        onClick={() => handlePrintMpLabel(i)}
                      >
                        <Icon
                          name={labelBusyId === i.id ? 'Loader2' : 'Printer'}
                          size={12}
                          className={labelBusyId === i.id ? 'animate-spin' : ''}
                        />
                      </Button>
                    )}
                  </div>
                </TableCell>
                <TableCell>{i.shelfName || '—'}</TableCell>
                <TableCell>{i.shippedAt ? formatDate(i.shippedAt) : '—'}</TableCell>
                {/* Дата возврата: когда вещь приехала обратно и легла на склад. */}
                <TableCell>{formatDate(i.receivedAt)}</TableCell>
                {/* Удаление доступно только администратору: для вещей на хранении и на
                    разборе с производства. Во втором случае это ошибочные приёмки и вещи,
                    которых по факту нет, — без удаления они висят вечно и кладовщик каждый
                    раз идёт искать несуществующий товар. Из остальных состояний удалять
                    нельзя: вещь в работе. */}
                {isAdmin && (
                  <TableCell>
                    {(i.status === 'in_stock' || i.status === 'awaiting_shelf') && onDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Удалить со склада"
                        onClick={() => setDeleteId(i.id)}
                      >
                        <Icon name="Trash2" size={14} className="text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                )}
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

      {/* Удаление со склада: вещь исчезает из учёта совсем, поэтому спрашиваем
          подтверждение — вернуть её можно будет только новой приёмкой. */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить товар со склада?</AlertDialogTitle>
            <AlertDialogDescription>
              Запись пропадёт из учёта. Если вещь физически на месте, вернуть её можно
              будет только новой приёмкой.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? 'Удаление...' : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default GoodsWarehouseTable;