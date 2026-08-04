import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { Order, OrderDetail } from '@/lib/ordersApi';
import type { Employee } from '@/lib/usersApi';
import type { Workshop } from '@/lib/workshopsApi';
import type { Roll } from '@/lib/rollsApi';
import FboStickerCard from '@/components/crm/sewingItems/FboStickerCard';
import SewingItemActionsSection from '@/components/crm/sewingItems/SewingItemActionsSection';
import SewingItemInfoCards from '@/components/crm/sewingItems/SewingItemInfoCards';
import SewingItemTimeline from '@/components/crm/sewingItems/SewingItemTimeline';
import SewingItemCancelConfirm from '@/components/crm/sewingItems/SewingItemCancelConfirm';

interface SewingItemDetailDialogProps {
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  selectedOrder: Order | null;
  orderDetail: OrderDetail | null;
  detailLoading: boolean;
  saving: boolean;
  cutting: boolean;
  employees: Employee[];
  workshops: Workshop[];
  onStatusChange: (status: string) => void;
  onAssignUser: (userId: string) => void;
  onAssignWorkshop: (workshopId: string) => void;
  onCut: (rollId?: number, hangerNumber?: number) => void;
  readOnly?: boolean;
  isCutterView?: boolean;
  isSewerView?: boolean;
  availableRolls?: Roll[];
  onSendToStickering?: (rollId?: number) => void;
  onCancelOrder?: () => void;
  cancelling?: boolean;
  /** Перезагрузка заказа после привязки товара (штрихкод стикера FBO). */
  onOrderUpdated?: () => void;
}

const SewingItemDetailDialog = ({
  dialogOpen,
  setDialogOpen,
  selectedOrder,
  orderDetail,
  detailLoading,
  saving,
  cutting,
  employees,
  workshops,
  onStatusChange,
  onAssignUser,
  onAssignWorkshop,
  onCut,
  readOnly = false,
  isCutterView = false,
  isSewerView = false,
  availableRolls = [],
  onSendToStickering,
  onCancelOrder,
  cancelling = false,
  onOrderUpdated,
}: SewingItemDetailDialogProps) => {
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const canCancel =
    !!onCancelOrder &&
    ((isCutterView && selectedOrder?.sewingStatus === 'На раскрое') ||
      (isSewerView && selectedOrder?.sewingStatus === 'В работе'));

  const cancelTargetLabel = isCutterView ? '«Новый»' : '«Раскроено»';

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle>Товар #{selectedOrder?.id}</DialogTitle>
            {selectedOrder && <Badge variant="secondary">{selectedOrder.sewingStatus}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            {canCancel && (
              <Button
                variant="outline"
                size="sm"
                className="w-fit text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setCancelConfirmOpen(true)}
                disabled={cancelling}
              >
                <Icon name="Ban" size={14} className="mr-1.5" />
                Отменить заказ
              </Button>
            )}
          </div>
        </DialogHeader>

        <SewingItemCancelConfirm
          open={cancelConfirmOpen}
          onOpenChange={setCancelConfirmOpen}
          cancelTargetLabel={cancelTargetLabel}
          onConfirm={() => {
            setCancelConfirmOpen(false);
            onCancelOrder?.();
          }}
        />
        {selectedOrder && (
          <div className="space-y-4">
            {!readOnly && (
              <SewingItemActionsSection
                selectedOrder={selectedOrder}
                orderDetail={orderDetail}
                saving={saving}
                cutting={cutting}
                employees={employees}
                workshops={workshops}
                onStatusChange={onStatusChange}
                onAssignUser={onAssignUser}
                onAssignWorkshop={onAssignWorkshop}
                onCut={onCut}
                isCutterView={isCutterView}
                isSewerView={isSewerView}
                availableRolls={availableRolls}
                onSendToStickering={onSendToStickering}
                dialogOpen={dialogOpen}
              />
            )}

            <SewingItemInfoCards
              selectedOrder={selectedOrder}
              orderDetail={orderDetail}
              detailLoading={detailLoading}
            />

            {selectedOrder.orderType === 'FBO' && (
              <FboStickerCard
                order={selectedOrder}
                orderDetail={orderDetail}
                onSaved={() => onOrderUpdated?.()}
              />
            )}

            <SewingItemTimeline selectedOrder={selectedOrder} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SewingItemDetailDialog;
