import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { Order, OrderDetail } from '@/lib/ordersApi';
import { marketplaceLogo } from '@/components/crm/sewingItems/sewingItemsShared';
import OrderStagesDiagram from '@/components/crm/sewingItems/OrderStagesDiagram';
import { formatQuantity } from '@/lib/formatQuantity';

interface SewingItemInfoCardsProps {
  selectedOrder: Order;
  orderDetail: OrderDetail | null;
  detailLoading: boolean;
}

const SewingItemInfoCards = ({
  selectedOrder,
  orderDetail,
  detailLoading,
}: SewingItemInfoCardsProps) => {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card className="border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Информация</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">Товар</TableCell>
                <TableCell>
                  {selectedOrder.material} {selectedOrder.width}×{selectedOrder.height}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">Номер заказа</TableCell>
                <TableCell>{selectedOrder.orderNumber}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">Маркетплейс</TableCell>
                <TableCell>
                  <span className={marketplaceLogo[selectedOrder.marketplace]?.className}>
                    {marketplaceLogo[selectedOrder.marketplace]?.label || selectedOrder.marketplace}
                  </span>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">Тип</TableCell>
                <TableCell>{selectedOrder.orderType}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">Кластер</TableCell>
                <TableCell>{selectedOrder.cluster || '—'}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Материалы</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {detailLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon name="Loader2" size={14} className="animate-spin" />
              Загрузка...
            </div>
          ) : orderDetail && orderDetail.materialUsage.length > 0 ? (
            orderDetail.materialUsage.map((mu) => (
              <div key={mu.id} className="rounded border border-border p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold">{mu.materialName}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatQuantity(mu.quantity)} {mu.unit}
                  </span>
                </div>
                {mu.rollBarcode && (
                  <div className="text-xs text-muted-foreground">
                    Рулон #{mu.rollBarcode}
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              Материалы ещё не списаны — выполните раскрой
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Сотрудники</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <OrderStagesDiagram order={selectedOrder} />
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">Назначен сейчас</TableCell>
                <TableCell>{selectedOrder.assignedUserName || '—'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">Вешалка</TableCell>
                <TableCell>{selectedOrder.hangerNumber > 0 ? `№ ${selectedOrder.hangerNumber}` : '—'}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default SewingItemInfoCards;
