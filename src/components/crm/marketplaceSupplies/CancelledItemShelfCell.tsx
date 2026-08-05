import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { printStorageSticker } from '@/lib/printStorageSticker';
import {
  cancelledToShelf,
  type SupplyItem,
  type SupplyShelf,
} from '@/lib/marketplaceSuppliesApi';

interface CancelledItemShelfCellProps {
  item: SupplyItem;
  shelves: SupplyShelf[];
  onDone: () => void;
}

/**
 * Управление отменённым заказом прямо в строке поставки.
 *
 * Заказ могут отменить уже после стикеровки — когда вещь сшита, застикерована и лежит в
 * собранной поставке. Отгружать её нельзя: покупателя больше нет. Здесь кладовщик, не
 * уходя со страницы поставки, выбирает полку, печатает стикер хранения и отправляет вещь
 * на склад — она встанет в остатки и уйдёт следующему покупателю.
 *
 * Для связки Яндекса на полку уезжает ВСЯ связка: ярлык на неё общий, поэтому отгрузить
 * остаток заказа невозможно.
 */
const CancelledItemShelfCell = ({ item, shelves, onDone }: CancelledItemShelfCellProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [shelfId, setShelfId] = useState('');
  const [saving, setSaving] = useState(false);

  const isGroup = !!item.groupKey && (item.groupSize || 0) > 1;

  const handlePrint = () => {
    if (!item.storageBarcode) return;
    printStorageSticker({
      storageBarcode: item.storageBarcode,
      title:
        item.material && item.width
          ? `${item.material} ${item.width}×${item.height}`
          : item.product,
      orderNumber: item.orderNumber,
    });
  };

  const handleSend = async () => {
    if (!shelfId) {
      toast({ title: 'Выберите полку', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await cancelledToShelf(item.id, Number(shelfId), {
        id: user?.id,
        name: user?.name,
      });
      toast({
        title: res.groupKey
          ? `Связка убрана на полку: ${res.movedCount} шт.`
          : 'Товар отправлен на полку',
        description: `Полка «${res.shelfName}» — вещь ждёт нового покупателя`,
      });
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось отправить на полку',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={shelfId} onValueChange={setShelfId} disabled={saving}>
        <SelectTrigger className="h-9 w-[150px]">
          <SelectValue placeholder="Полка" />
        </SelectTrigger>
        <SelectContent>
          {shelves.length === 0 ? (
            <SelectItem value="none" disabled>
              Полок нет
            </SelectItem>
          ) : (
            shelves.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>
                {s.name}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="sm"
        onClick={handlePrint}
        disabled={!item.storageBarcode}
        title="Напечатать стикер хранения"
      >
        <Icon name="Printer" size={14} className="mr-1.5" />
        Стикер
      </Button>

      <Button size="sm" onClick={handleSend} disabled={saving || !shelfId}>
        <Icon
          name={saving ? 'Loader2' : 'PackageCheck'}
          size={14}
          className={`mr-1.5 ${saving ? 'animate-spin' : ''}`}
        />
        {isGroup ? `На полку связку (${item.groupSize})` : 'На полку'}
      </Button>
    </div>
  );
};

export default CancelledItemShelfCell;
