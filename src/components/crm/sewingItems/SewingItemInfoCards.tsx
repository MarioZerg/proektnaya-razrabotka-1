import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Icon from '@/components/ui/icon';
import type { Order, OrderDetail } from '@/lib/ordersApi';
import OrderStagesDiagram from '@/components/crm/sewingItems/OrderStagesDiagram';
import { formatQuantity } from '@/lib/formatQuantity';
import { orderHangerLabel } from '@/lib/hangersApi';
import { fabricUses4cmHbTape, is6cmTapeName } from '@/lib/tapeForFabric';

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
  const hide6cmTape = fabricUses4cmHbTape(
    selectedOrder.material,
    selectedOrder.requiresOverlock,
  );
  const materialUsage = (orderDetail?.materialUsage || []).filter(
    (mu) => !(hide6cmTape && is6cmTapeName(mu.materialName)),
  );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card className="border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Информация</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="min-w-0">
            <TableBody>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">Товар</TableCell>
                <TableCell>
                  {selectedOrder.material} {selectedOrder.width}×{selectedOrder.height}
                </TableCell>
              </TableRow>
              {/* Покупатель-компания: реквизиты приходят от OZON вместе с заказом. */}
              {selectedOrder.isLegalEntity && (
                <TableRow>
                  <TableCell className="font-medium text-muted-foreground">Покупатель</TableCell>
                  <TableCell>
                    <span className="mr-2 inline-block rounded-sm bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-800">
                      Юр. лицо
                    </span>
                    {selectedOrder.legalCompanyName || 'Компания'}
                    {selectedOrder.legalInn && (
                      <div className="font-mono-tech text-xs text-muted-foreground">
                        ИНН {selectedOrder.legalInn}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Материалы</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* ИЗ КАКОГО КУСКА СДЕЛАНА ВЕЩЬ — ТОЛЬКО ПОКА ОНА НА РАСКРОЕ.
              Дальше по конвейеру отдельная карточка перешива только путает:
              швея и упаковщица видят «есть куски», хотя брать ткань уже
              некому. В расходе материалов ниже по-прежнему видно, что рулон
              не списывался. */}
          {selectedOrder.sewingStatus === 'На раскрое' && orderDetail?.repairPiece && (
            <div className="rounded border-2 border-violet-300 bg-violet-50 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Icon name="Scissors" size={14} className="shrink-0 text-violet-700" />
                <span className="font-semibold text-violet-900">Скроено из куска</span>
                {orderDetail.repairPiece.barcode && (
                  <span className="font-mono-tech font-bold text-violet-900">
                    {orderDetail.repairPiece.barcode}
                  </span>
                )}
              </div>
              <p className="text-sm text-violet-900">
                {orderDetail.repairPiece.material} {orderDetail.repairPiece.width}×
                {orderDetail.repairPiece.height}
              </p>
              {orderDetail.repairPiece.reasonLabel && (
                <p className="text-xs text-violet-900/80">
                  Причина перешива: {orderDetail.repairPiece.reasonLabel}
                </p>
              )}
              <p className="text-xs text-violet-900/70">
                {orderDetail.repairPiece.createdByName
                  ? `Отправил(а) ${orderDetail.repairPiece.createdByName}`
                  : ''}
                {orderDetail.repairPiece.usedByName
                  ? ` · взял(а) ${orderDetail.repairPiece.usedByName}`
                  : ''}
              </p>
              <p className="mt-1 text-xs font-medium text-violet-900">
                Рулон на эту вещь не расходовался
              </p>
            </div>
          )}

          {detailLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon name="Loader2" size={14} className="animate-spin" />
              Загрузка...
            </div>
          ) : (
            <>
              {orderDetail?.requiredTrimMaterialName && (
                <div className="rounded border border-fuchsia-200 bg-fuchsia-50/60 p-2">
                  <div className="text-xs text-muted-foreground">Тесьма</div>
                  <div className="font-semibold">{orderDetail.requiredTrimMaterialName}</div>
                </div>
              )}
              {materialUsage.length > 0
                ? materialUsage.map((mu) => (
                    <div key={mu.id} className="rounded border border-border p-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-semibold">{mu.materialName}</span>
                        <span className="text-sm text-muted-foreground">
                          {formatQuantity(mu.quantity)} {mu.unit}
                        </span>
                      </div>
                      {mu.rollBarcode ? (
                        <div className="text-xs text-muted-foreground">
                          Рулон #{mu.rollBarcode}
                        </div>
                      ) : (
                        <div className="text-xs font-medium text-violet-700">
                          С перешива — рулон не расходовался
                          {orderDetail?.repairPiece?.barcode
                            ? ` (${orderDetail.repairPiece.barcode})`
                            : ''}
                        </div>
                      )}
                    </div>
                  ))
                : (
                    <p className="text-sm text-muted-foreground">
                      Материалы ещё не списаны — выполните раскрой
                    </p>
                  )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-border shadow-none">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Сотрудники</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <OrderStagesDiagram order={selectedOrder} />
          <Table className="min-w-0">
            <TableBody>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">Назначен сейчас</TableCell>
                <TableCell>{selectedOrder.assignedUserName || '—'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">Вешалка</TableCell>
                <TableCell>{orderHangerLabel(selectedOrder)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default SewingItemInfoCards;