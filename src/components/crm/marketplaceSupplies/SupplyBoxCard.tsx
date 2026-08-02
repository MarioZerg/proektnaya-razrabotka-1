import { useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { SupplyBox } from '@/lib/marketplaceSuppliesApi';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';

interface SupplyBoxCardProps {
  box: SupplyBox;
  canEdit: boolean;
  onAddOrder: (boxId: number, orderNumber: string) => Promise<void>;
  onRemoveItem: (itemId: number) => void;
  onDeleteBox: (boxId: number) => void;
}

const SupplyBoxCard = ({ box, canEdit, onAddOrder, onRemoveItem, onDeleteBox }: SupplyBoxCardProps) => {
  const [orderNumber, setOrderNumber] = useState('');
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAdd = async () => {
    const value = orderNumber.trim();
    if (!value) return;
    setScanning(true);
    try {
      await onAddOrder(box.id, value);
      setOrderNumber('');
    } finally {
      setScanning(false);
      inputRef.current?.focus();
    }
  };

  useScannerAutoSubmit(orderNumber, handleAdd, canEdit && !scanning);

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="text-sm">
          Короб №{box.boxNumber}{' '}
          <span className="font-mono-tech text-xs font-normal text-muted-foreground">({box.barcode})</span>
        </CardTitle>
        {canEdit && box.items.length === 0 && (
          <Button variant="ghost" size="icon" onClick={() => onDeleteBox(box.id)}>
            <Icon name="Trash2" size={14} />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {canEdit && (
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              placeholder="Номер заказа"
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              disabled={scanning}
              className="font-mono-tech"
            />
            <Button size="sm" onClick={handleAdd} disabled={scanning || !orderNumber.trim()}>
              {scanning ? <Icon name="Loader2" size={14} className="animate-spin" /> : <Icon name="Plus" size={14} />}
            </Button>
          </div>
        )}

        {box.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">В коробе пока нет товаров</p>
        ) : (
          <div className="space-y-1.5">
            {box.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.orderNumber || '—'}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.product} {item.material ? `— ${item.material}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="shrink-0">
                    {item.goodsStatus === 'reserved' ? 'Зарезервирован' : item.goodsStatus === 'shipped' ? 'Отгружен' : item.goodsStatus}
                  </Badge>
                  {canEdit && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => onRemoveItem(item.id)}>
                      <Icon name="X" size={12} />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SupplyBoxCard;