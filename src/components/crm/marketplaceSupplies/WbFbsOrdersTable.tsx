import B2bBadge from './B2bBadge';
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
import { printLabelFromUrl } from '@/lib/printMarketplaceLabel';
import type { SupplyAwaitingItem, WbSupplyOrder } from '@/lib/marketplaceSuppliesApi';

interface WbFbsOrdersTableProps {
  wbOrders: WbSupplyOrder[];
  wbAwaiting: SupplyAwaitingItem[];
  canRemove: boolean;
  removingId: number | null;
  shelvingId: number | null;
  onRemove: (orderId: number, orderNumber: string) => void;
  onShelf: (orderId: number, orderNumber: string) => void;
}

/** Чек-лист сборки WB FBS: отсканированные заказы и те, что ещё ждут сканирования. */
const WbFbsOrdersTable = ({
  wbOrders,
  wbAwaiting,
  canRemove,
  removingId,
  shelvingId,
  onRemove,
  onShelf,
}: WbFbsOrdersTableProps) => (
  <>
    <h3 className="pt-2 text-sm font-semibold">
      Собрано {wbOrders.length} из {wbOrders.length + wbAwaiting.length}
    </h3>
    {wbOrders.length === 0 && wbAwaiting.length === 0 ? (
      <p className="text-sm text-muted-foreground">Заказов в поставке пока нет</p>
    ) : (
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="w-10 text-primary-foreground"></TableHead>
              <TableHead className="text-primary-foreground">Заказ</TableHead>
              <TableHead className="text-primary-foreground">Товар</TableHead>
              <TableHead className="text-primary-foreground">Материал</TableHead>
              <TableHead className="text-primary-foreground">Размер</TableHead>
              <TableHead className="text-primary-foreground">Стикеровал</TableHead>
              <TableHead className="text-primary-foreground">Короб WB</TableHead>
              <TableHead className="text-primary-foreground">Стикер короба</TableHead>
              {canRemove && <TableHead className="text-primary-foreground"></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {wbOrders.map((o) => (
              <TableRow
                key={o.id}
                className={o.isCancelled ? 'bg-destructive/5' : 'bg-emerald-50 hover:bg-emerald-100'}
              >
                <TableCell>
                  <Icon
                    name="CircleCheck"
                    size={18}
                    className={o.isCancelled ? 'text-destructive' : 'text-emerald-600'}
                  />
                </TableCell>
                <TableCell className="font-medium">
                  {o.orderNumber}
                  {o.isB2b && <B2bBadge className="ml-2" />}
                  {o.isCancelled && (
                    <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                      отменён
                    </span>
                  )}
                </TableCell>
                <TableCell>{o.product || '—'}</TableCell>
                <TableCell>{o.material || '—'}</TableCell>
                <TableCell>
                  {o.width && o.height ? `${o.width}×${o.height}` : '—'}
                </TableCell>
                <TableCell className="text-sm">{o.labeledByName || '—'}</TableCell>
                <TableCell className="font-mono-tech">{o.wbTrbxId || '—'}</TableCell>
                <TableCell>
                  {o.stickerUrl ? (
                    // Печать на наклейке 58×40. Открытие ссылкой оставляем рядом:
                    // из просмотрщика браузера стикер печатался на A4 с полями.
                    <button
                      type="button"
                      onClick={() =>
                        printLabelFromUrl(o.stickerUrl!, 'Стикер короба WB')
                      }
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <Icon name="Printer" size={16} />
                      Печать
                    </button>
                  ) : (
                    '—'
                  )}
                </TableCell>
                {canRemove && (
                  <TableCell className="whitespace-nowrap">
                    {/* Отменённый заказ везти нельзя: кладовщик убирает его прямо
                        отсюда — вещь уходит на полку, а с WB задание снимается. */}
                    {o.isCancelled && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mr-1"
                        onClick={() => onShelf(o.orderId, o.orderNumber)}
                        disabled={shelvingId === o.orderId}
                        title="Убрать из поставки и положить на полку"
                      >
                        <Icon
                          name={shelvingId === o.orderId ? 'Loader2' : 'PackageOpen'}
                          size={14}
                          className={`mr-1 ${shelvingId === o.orderId ? 'animate-spin' : ''}`}
                        />
                        На полку
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemove(o.orderId, o.orderNumber)}
                      disabled={removingId === o.orderId}
                      title="Убрать заказ из поставки"
                    >
                      <Icon name={removingId === o.orderId ? 'Loader2' : 'Trash2'} size={14} className={removingId === o.orderId ? 'animate-spin' : ''} />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}

            {/* Ещё не отсканированные: лежат в резервной поставке WB и ждут, когда
                кладовщик принесёт их и пикнет ярлык. */}
            {wbAwaiting.map((a) => (
              <TableRow key={`wait-${a.id}`} className="hover:bg-muted/60">
                <TableCell>
                  <Icon name="Circle" size={18} className="text-muted-foreground/40" />
                </TableCell>
                <TableCell className="font-medium">
                  <span className="break-all">{a.orderNumber || '—'}</span>
                  {a.isB2b && <B2bBadge className="ml-2" />}
                  {a.shelfName && (
                    <div className="text-xs text-muted-foreground">Полка «{a.shelfName}»</div>
                  )}
                </TableCell>
                <TableCell>{a.product || '—'}</TableCell>
                <TableCell>{a.material || '—'}</TableCell>
                <TableCell>
                  {a.width && a.height ? `${a.width}×${a.height}` : '—'}
                </TableCell>
                <TableCell className="text-sm">{a.labeledByName || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">—</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Ждёт сканирования
                </TableCell>
                {canRemove && <TableCell />}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )}
  </>
);

export default WbFbsOrdersTable;
