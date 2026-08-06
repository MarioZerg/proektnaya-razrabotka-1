import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { marketplaceLogo } from '@/components/crm/sewingItems/sewingItemsShared';
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
  /** Раскроить всю связку Яндекса разом (заказ покупателя из нескольких вещей). */
  onCutGroup: (rollId?: number, hangerNumber?: number) => void;
  readOnly?: boolean;
  isCutterView?: boolean;
  isSewerView?: boolean;
  /** Блок «Действия» со сменой статуса, назначением сотрудника/цеха доступен только админу. */
  isAdminView?: boolean;
  availableRolls?: Roll[];
  onSendToStickering?: (rollId?: number) => void;
  onCancelOrder?: () => void;
  cancelling?: boolean;
  /** Штраф за отмену заказа из настроек цеха — показывается в окне подтверждения. */
  cancelOrderPenalty?: number;
  /** Карточку открыл упаковщик — часть админских блоков ему не нужна. */
  isPackerView?: boolean;
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
  onCutGroup,
  readOnly = false,
  isCutterView = false,
  isSewerView = false,
  isAdminView = false,
  availableRolls = [],
  onSendToStickering,
  onCancelOrder,
  cancelling = false,
  cancelOrderPenalty = 0,
  isPackerView = false,
  onOrderUpdated,
}: SewingItemDetailDialogProps) => {
  const { user } = useAuth();
  // Менеджер смотрит заказы только как справку и стикерами не занимается.
  const isManager = user?.role === 'manager';
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const canCancel =
    !!onCancelOrder &&
    ((isCutterView && selectedOrder?.sewingStatus === 'На раскрое') ||
      (isSewerView && selectedOrder?.sewingStatus === 'В работе'));

  const cancelTargetLabel = isCutterView ? '«Новый»' : '«Раскроено»';

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto p-4 sm:max-w-4xl sm:p-6">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle>Товар #{selectedOrder?.id}</DialogTitle>
            {selectedOrder && <Badge variant="secondary">{selectedOrder.sewingStatus}</Badge>}
          </div>
          {/* Маркетплейс, схема (FBO/FBS) и полный номер заказа — сразу в шапке: раньше их
              приходилось искать в таблице ниже, а на телефоне номер ещё и обрезался. */}
          {selectedOrder && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span
                className={`text-sm ${marketplaceLogo[selectedOrder.marketplace]?.className || 'font-bold'}`}
              >
                {marketplaceLogo[selectedOrder.marketplace]?.label || selectedOrder.marketplace}
              </span>
              <Badge variant="outline">{selectedOrder.orderType}</Badge>
              {/* Связка Яндекса: швея должна видеть, что это часть большого заказа и сколько
                  вещей в нём всего — заказ шьётся целиком одним человеком. */}
              {selectedOrder.groupSize && selectedOrder.groupSize > 1 && (
                <Badge className="bg-violet-600 text-white hover:bg-violet-600">
                  Связка: вещь {selectedOrder.groupPosition} из {selectedOrder.groupSize}
                </Badge>
              )}
              {selectedOrder.cluster && (
                <Badge variant="outline" className="text-muted-foreground">
                  {selectedOrder.cluster}
                </Badge>
              )}
              <span className="w-full break-all font-mono-tech text-xs text-muted-foreground">
                {selectedOrder.orderNumber}
              </span>
            </div>
          )}
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
          penalty={cancelOrderPenalty}
          onConfirm={() => {
            setCancelConfirmOpen(false);
            onCancelOrder?.();
          }}
        />
        {selectedOrder && (
          <div className="space-y-4">
            {/* Раскрой/стикеровку выполняют закройщик и швея. Общий блок «Действия» со сменой
                статуса и назначением сотрудника/цеха доступен только админу — остальные роли
                (кладовщик, менеджер) двигать заказ по статусам не могут. */}
            {!readOnly && (isCutterView || isSewerView || isAdminView) && (
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
                onCutGroup={onCutGroup}
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

            {/* Привязка стикера FBO — задача администратора и кладовщика. Упаковщик
                печатает стикер на терминале в цехе, а менеджер заказами не занимается:
                обоим эта плашка в карточке только мешает. */}
            {selectedOrder.orderType === 'FBO' && !isPackerView && !isManager && (
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