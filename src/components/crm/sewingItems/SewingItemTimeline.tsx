import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';
import { formatDate, timeAgo } from '@/components/crm/sewingItems/sewingItemsShared';

interface SewingItemTimelineProps {
  selectedOrder: Order;
}

const SewingItemTimeline = ({ selectedOrder }: SewingItemTimelineProps) => {
  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Таймлайн</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Badge variant="outline">{formatDate(selectedOrder.createdAt)}</Badge>
          <span className="flex items-center gap-1.5 text-sm">
            <Icon name="Plus" size={14} className="text-blue-600" />
            Заказ создан
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{timeAgo(selectedOrder.createdAt)}</Badge>
          <span className="flex items-center gap-1.5 text-sm">
            <Icon name="MapPin" size={14} className="text-muted-foreground" />
            <Badge variant="secondary">{selectedOrder.sewingStatus}</Badge>
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

export default SewingItemTimeline;
