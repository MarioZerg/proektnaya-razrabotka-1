import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Icon from '@/components/ui/icon';
import { formatQuantity } from '@/lib/formatQuantity';
import type { ShipmentDetail, ShipmentItem } from '@/lib/shipmentsApi';

/**
 * Таблица рулонов приёмки для широких экранов.
 * Логика и разметка 1:1 перенесены из SupplyShow.
 */
interface Props {
  filtered: ShipmentItem[];
  detail: ShipmentDetail;
  isAdmin: boolean;
  editItemId: number | null;
  setEditItemId: (id: number | null) => void;
  editValue: string;
  setEditValue: (v: string) => void;
  savingQty: boolean;
  onSaveQuantity: (item: ShipmentItem) => void;
  onPrintItem: (item: ShipmentItem) => void;
}

const SupplyShowTable = ({
  filtered,
  detail,
  isAdmin,
  editItemId,
  setEditItemId,
  editValue,
  setEditValue,
  savingQty,
  onSaveQuantity,
  onPrintItem,
}: Props) => (
  <div className="hidden min-w-0 overflow-hidden rounded-md border md:block">
    <Table className="min-w-0 table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[28%] whitespace-normal">Рулон</TableHead>
          <TableHead className="w-[18%] whitespace-normal text-right">
            Метраж
            {isAdmin && (
              <span className="ml-1 font-normal text-muted-foreground">
                (можно менять)
              </span>
            )}
          </TableHead>
          <TableHead className="w-[22%] whitespace-normal">Где / поставщик</TableHead>
          <TableHead className="w-[20%] whitespace-normal text-right">Себестоимость</TableHead>
          <TableHead className="w-[12%] whitespace-normal" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
              Ничего не найдено
            </TableCell>
          </TableRow>
        )}
        {filtered.map((item) => {
          const code = item.barcode || item.reservedBarcodes?.[0];
          const editing = editItemId === item.id;
          return (
            <TableRow key={item.id} className={item.removedAt ? 'opacity-60' : undefined}>
              <TableCell className="whitespace-normal break-words align-top">
                <div className={`font-medium ${item.removedAt ? 'line-through' : ''}`}>
                  {item.materialName}
                </div>
                <div className="mt-0.5 break-all font-mono-tech text-xs text-muted-foreground">
                  {code || '—'}
                </div>
              </TableCell>
              <TableCell className="text-right align-top">
                {editing ? (
                  <div className="flex items-center justify-end gap-1">
                    <Input
                      autoFocus
                      inputMode="decimal"
                      className="h-8 w-24 text-right"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                    <Button
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onSaveQuantity(item)}
                      disabled={savingQty}
                    >
                      <Icon name="Check" size={14} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => setEditItemId(null)}
                    >
                      <Icon name="X" size={14} />
                    </Button>
                  </div>
                ) : isAdmin && item.canEditQuantity ? (
                  /* КЛИКАБЕЛЬНЫЙ МЕТРАЖ. Раньше правка висела серым карандашом
                     в дальней колонке справа — администратор её просто не находил.
                     Теперь нажимается само число: рядом с ним стоит карандаш,
                     и подпись прямо говорит, что цифру можно менять. */
                  <button
                    type="button"
                    className="ml-auto flex items-center gap-1.5 rounded-md border border-dashed
                               border-primary/40 px-2 py-1 text-right font-medium
                               hover:border-primary hover:bg-primary/5"
                    title="Нажмите, чтобы изменить метраж рулона"
                    onClick={() => {
                      setEditItemId(item.id);
                      setEditValue(String(item.quantity ?? ''));
                    }}
                  >
                    <Icon name="Pencil" size={12} className="text-primary" />
                    {formatQuantity(item.quantity)} {item.unit}
                  </button>
                ) : (
                  <span className="font-medium">
                    {formatQuantity(item.quantity)} {item.unit}
                  </span>
                )}
              </TableCell>
              <TableCell className="whitespace-normal break-words align-top">
                <div>
                  {/* Рулон убран администратором: строка приёмки осталась как часть
                      первичного документа, но материала на складе нет. Без этой
                      пометки приёмка обещала бы рулон, которого не существует. */}
                  {item.removedAt && (
                    <Badge variant="destructive">Убран</Badge>
                  )}
                  {!item.removedAt && item.rollStatus === 'in_storage' && (
                    <Badge variant="secondary">На складе</Badge>
                  )}
                  {!item.removedAt && item.rollStatus === 'in_workshop' && (
                    <Badge variant="default">В цехе</Badge>
                  )}
                  {!item.removedAt && item.rollStatus === 'completed' && (
                    <Badge variant="outline">Израсходован</Badge>
                  )}
                  {!item.removedAt && !item.rollStatus && (
                    <span className="text-xs text-muted-foreground">не принят</span>
                  )}
                </div>
                {item.removedAt && (
                  <div className="mt-1 text-xs text-destructive">
                    {item.removedReason || 'Убран из работы'}
                    {item.removedByName ? ` · ${item.removedByName}` : ''}
                  </div>
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  {item.supplierName || detail.supplierName || '—'}
                </div>
              </TableCell>
              <TableCell className="text-right text-sm align-top">
                {item.costPerUnit != null
                  ? `${item.costPerUnit.toFixed(2)} ₽`
                  : '—'}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    title="Печать стикера рулона (120×75 мм)"
                    onClick={() => onPrintItem(item)}
                  >
                    <Icon name="Barcode" size={14} />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  </div>
);

export default SupplyShowTable;