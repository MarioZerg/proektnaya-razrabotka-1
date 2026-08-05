import { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import type { SupplyDetail } from '@/lib/marketplaceSuppliesApi';
import type { GoodsWarehouseItem } from '@/lib/goodsWarehouseApi';
import { useScannerAutoSubmit } from '@/hooks/useScannerAutoSubmit';

interface SupplyItemsSectionProps {
  supply: SupplyDetail;
  supplyId: number;
  canEditItems: boolean;
  readyGoods: GoodsWarehouseItem[];
  scanOrderNumber: string;
  setScanOrderNumber: (value: string) => void;
  scanning: boolean;
  scanInputRef: RefObject<HTMLInputElement>;
  onScanOrder: () => void;
  onRemoveItem: (itemId: number) => void;
  onNavigateAssemble: () => void;
}

const SupplyItemsSection = ({
  supply,
  canEditItems,
  readyGoods,
  scanOrderNumber,
  setScanOrderNumber,
  scanning,
  scanInputRef,
  onScanOrder,
  onRemoveItem,
  onNavigateAssemble,
}: SupplyItemsSectionProps) => {
  useScannerAutoSubmit(scanOrderNumber, onScanOrder, !scanning && supply.type === 'FBS' && canEditItems);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {supply.type === 'FBS' ? (
          <div className="flex flex-wrap gap-4 text-sm">
            <span>
              Отобрано к подбору: <b>{readyGoods.length}</b>
            </span>
            <span>
              Добавлено товаров: <b>{supply.items.length}</b>
            </span>
          </div>
        ) : (
          <h2 className="font-semibold">Товары в поставке ({supply.items.length})</h2>
        )}
        {canEditItems && supply.type === 'FBO' && (
          <Button size="sm" onClick={onNavigateAssemble}>
            <Icon name="PackagePlus" size={14} className="mr-1" />
            Собрать поставку
          </Button>
        )}
      </div>

      {canEditItems && supply.type === 'FBS' && (
        <Card className="border-primary/30 bg-primary/5 shadow-none">
          <CardContent
            className="space-y-2 pt-6"
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest('input, button, a')) {
                scanInputRef.current?.focus();
              }
            }}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Icon name="ScanLine" size={18} />
              Отсканируйте штрихкод хранения товара, отобранного на складе
            </div>
            <div className="flex gap-2">
              <Input
                ref={scanInputRef}
                autoFocus
                placeholder="Штрихкод хранения (GW-000001)"
                value={scanOrderNumber}
                onChange={(e) => setScanOrderNumber(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onScanOrder()}
                disabled={scanning}
                className="font-mono-tech"
              />
              <Button onClick={onScanOrder} disabled={scanning || !scanOrderNumber.trim()}>
                {scanning ? <Icon name="Loader2" size={16} className="animate-spin" /> : 'Добавить товар'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {supply.type === 'FBS' && (
        readyGoods.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Нет товаров, отобранных к подбору — сначала отсканируйте нужные товары на складе в разделе «Товар к подбору»
          </p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-primary hover:bg-primary">
                  <TableHead className="text-primary-foreground">Штрихкод хранения</TableHead>
                  <TableHead className="text-primary-foreground">Заказ</TableHead>
                  <TableHead className="text-primary-foreground">Товар</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {readyGoods.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-mono-tech">{g.storageBarcode}</TableCell>
                    <TableCell className="font-medium">{g.orderNumber || '—'}</TableCell>
                    <TableCell>{g.product || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      )}

      {supply.type === 'FBS' && (
        <h3 className="pt-2 text-sm font-semibold">Добавлено в поставку ({supply.items.length})</h3>
      )}

      {supply.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">В поставке пока нет товаров</p>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-primary hover:bg-primary">
                <TableHead className="text-primary-foreground">Заказ</TableHead>
                <TableHead className="text-primary-foreground">Товар</TableHead>
                <TableHead className="text-primary-foreground">Материал</TableHead>
                <TableHead className="text-primary-foreground">Размер</TableHead>
                <TableHead className="text-primary-foreground">Статус</TableHead>
                {canEditItems && <TableHead className="text-primary-foreground"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {supply.items.map((item) => {
                // Связка этого товара: полностью собранные подсвечиваем зелёным, неполные —
                // жёлтым, чтобы кладовщик прямо в списке видел, что ещё нужно донести.
                const group = item.groupKey
                  ? supply.groups?.find((g) => g.groupKey === item.groupKey)
                  : undefined;
                return (
                <TableRow
                  key={item.id}
                  className={group && !group.isComplete ? 'bg-amber-50' : undefined}
                >
                  <TableCell className="font-medium">
                    <span className="break-all">{item.orderNumber || '—'}</span>
                    {group && (
                      <Badge
                        className={`ml-1.5 px-1.5 py-0 text-[10px] text-white ${
                          group.isComplete
                            ? 'bg-emerald-600 hover:bg-emerald-600'
                            : 'bg-amber-600 hover:bg-amber-600'
                        }`}
                      >
                        связка {group.inSupply}/{group.total}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{item.product || '—'}</TableCell>
                  <TableCell>{item.material || '—'}</TableCell>
                  <TableCell>
                    {item.width && item.height ? `${item.width}×${item.height}` : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {item.goodsStatus === 'reserved' ? 'Зарезервирован' : item.goodsStatus === 'shipped' ? 'Отгружен' : item.goodsStatus}
                    </Badge>
                  </TableCell>
                  {canEditItems && (
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => onRemoveItem(item.id)}>
                        <Icon name="Trash2" size={14} />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default SupplyItemsSection;