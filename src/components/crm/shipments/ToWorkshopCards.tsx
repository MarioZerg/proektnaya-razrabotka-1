import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { Shipment, ShipmentDetail } from '@/lib/shipmentsApi';
import type { Workshop } from '@/lib/workshopsApi';
import type { AccessZone } from '@/lib/roles';
import { formatDate, statusStyle, shiftLabel } from '@/components/crm/shipments/toWorkshopShared';
import { formatQuantity } from '@/lib/formatQuantity';

interface ToWorkshopCardsProps {
  shipments: Shipment[];
  workshops: Workshop[];
  zone: AccessZone;
  userWorkshopId: number | null;
  userShiftNumber: number | null;
  expandedRolls: Record<number, ShipmentDetail | null>;
  loadingRolls: number | null;
  onToggleRolls: (shipmentId: number) => void;
  onOpenShipment: (id: number) => void;
  onOpenReceiveDialog: (id: number) => void;
  onSetDeleteId: (id: number | null) => void;
}

/** Мобильный вид списка отгрузок в цех — карточки вместо широкой таблицы. */
const ToWorkshopCards = ({
  shipments,
  workshops,
  zone,
  userWorkshopId,
  userShiftNumber,
  expandedRolls,
  loadingRolls,
  onToggleRolls,
  onOpenShipment,
  onOpenReceiveDialog,
  onSetDeleteId,
}: ToWorkshopCardsProps) => {
  const canAssemble = zone === 'admin' || zone === 'warehouse';
  const canReceive = (s: Shipment) =>
    zone === 'admin' ||
    (zone === 'workshop' &&
      s.workshopId === userWorkshopId &&
      (s.shiftNumber === null || s.shiftNumber === userShiftNumber));

  return (
    <div className="space-y-3">
      {shipments.map((s) => {
        const detail = expandedRolls[s.id];
        const isExpanded = s.id in expandedRolls;
        const canExpand = s.status === 'Отправлено' || s.status === 'Получено';
        const needsCorrection = s.status === 'Отправлено' && !!s.rejectReason;
        return (
          <div key={s.id} className="rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">{s.materialNames || '—'}</div>
                <div className="text-xs text-muted-foreground">Заявка #{s.id}</div>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                <Badge className={statusStyle(s.status, needsCorrection)}>
                  {needsCorrection ? 'Нужна правка' : s.status}
                </Badge>
                {s.isAutoOrder && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    Автозаказ
                  </Badge>
                )}
              </div>
            </div>

            {needsCorrection && (
              <p className="mt-1 text-xs text-destructive">Отказано: {s.rejectReason}</p>
            )}

            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <div>
                <span className="text-muted-foreground">Цех: </span>
                {s.workshopName || '—'}
              </div>
              <div>
                <span className="text-muted-foreground">Смена: </span>
                {shiftLabel(workshops, s.workshopId, s.shiftNumber)}
              </div>
              <div>
                <span className="text-muted-foreground">Запросил: </span>
                {s.requestedByName || '—'}
              </div>
              <div>
                <span className="text-muted-foreground">Создано: </span>
                {formatDate(s.createdAt)}
              </div>
            </div>

            {s.comment && (
              <div className="mt-1 text-sm">
                <span className="text-muted-foreground">Комментарий: </span>
                {s.comment}
              </div>
            )}

            {canExpand && (
              <Collapsible open={isExpanded} className="mt-1.5">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0 py-0 text-xs"
                    onClick={() => onToggleRolls(s.id)}
                    disabled={loadingRolls === s.id}
                  >
                    <Icon
                      name={isExpanded ? 'ChevronDown' : 'ChevronRight'}
                      size={12}
                      className="mr-1"
                    />
                    {loadingRolls === s.id ? 'Загрузка...' : 'Показать рулоны'}
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1.5 space-y-1">
                  {detail?.items
                    .filter((item) => item.rollId !== null)
                    .map((item) => (
                      <div key={item.id} className="text-xs">
                        <span className="font-mono-tech font-medium">{item.rollBarcode}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          — {item.materialName}, {formatQuantity(item.quantity)} {item.unit}
                        </span>
                      </div>
                    ))}
                </CollapsibleContent>
              </Collapsible>
            )}

            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {canAssemble && s.status === 'Новый' && (
                <Button size="sm" variant="outline" onClick={() => onOpenShipment(s.id)}>
                  Собрать
                </Button>
              )}
              {canAssemble && needsCorrection && (
                <Button size="sm" variant="outline" onClick={() => onOpenShipment(s.id)}>
                  <Icon name="Wrench" size={14} className="mr-1" />
                  Исправить
                </Button>
              )}
              {s.status === 'Отправлено' && canReceive(s) && (
                <Button size="sm" onClick={() => onOpenReceiveDialog(s.id)}>
                  Принять в цехе
                </Button>
              )}
              {zone === 'admin' && (s.status === 'Новый' || s.status === 'Отправлено') && (
                <Button size="icon" variant="ghost" onClick={() => onSetDeleteId(s.id)}>
                  <Icon name="Trash2" size={14} />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ToWorkshopCards;
