import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import type { Shipment } from '@/lib/shipmentsApi';
import {
  accountantStatusLabel,
  accountantStatusVariant,
  statusVariant,
} from '@/components/crm/shipments/fromSupplierShared';
import { formatDate } from '@/lib/dateUtils';
import { formatQuantity } from '@/lib/formatQuantity';

interface SuppliesCardsProps {
  shipments: Shipment[];
  isAdmin: boolean;
  canEditPending: boolean;
  onOpenReview: (shipmentId: number) => void;
  onOpenLogistics: (shipmentId: number) => void;
  onPrintShipmentBarcodes: (shipmentId: number) => void;
  onPrintAcceptanceSheet: (shipmentId: number) => void;
  onSetDeleteId: (id: number | null) => void;
}

/**
 * Список приёмок карточками — и на телефоне, и на десктопе.
 * Таблица из пяти колонок сжимала даты, поставщика и кнопки в одну кучу.
 */
const SuppliesCards = ({
  shipments,
  isAdmin,
  canEditPending,
  onOpenReview,
  onOpenLogistics,
  onPrintShipmentBarcodes,
  onPrintAcceptanceSheet,
  onSetDeleteId,
}: SuppliesCardsProps) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-3">
      {shipments.map((s) => {
        const isPending = s.status === 'Новый';
        const supplier = s.itemSuppliers || s.supplierName || '—';
        return (
          <article key={s.id} className="rounded-xl border border-border bg-card p-4 sm:p-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">Приёмка #{s.id}</h2>
                <Badge variant={statusVariant[s.status] || 'secondary'}>
                  {isPending ? 'Ожидает проверки' : s.status}
                </Badge>
                {s.accountantStatus && (
                  <Badge variant={accountantStatusVariant[s.accountantStatus] || 'outline'}>
                    {accountantStatusLabel[s.accountantStatus] || s.accountantStatus}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-foreground">{supplier}</p>
              <p className="text-sm text-muted-foreground">
                {s.itemsCount} поз. · {formatQuantity(s.totalQuantity)} метр/шт
                {s.createdByName ? ` · ${s.createdByName}` : ''}
              </p>
              <p className="text-xs text-muted-foreground">
                Создана {formatDate(s.createdAt)}
                {s.completedAt ? ` · принята ${formatDate(s.completedAt)}` : ''}
              </p>
              {s.comment && (
                <p className="max-w-2xl text-xs text-muted-foreground">{s.comment}</p>
              )}
              {s.accountantStatus === 'correction' && s.accountantComment && (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  Бухгалтер не подтвердила. Причина: {s.accountantComment}
                </p>
              )}
              {s.accountantStatus === 'pending' && (
                <p className="text-xs text-muted-foreground">
                  Напечатайте лист приёмки и отнесите бухгалтеру в офис
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {isPending && (isAdmin || canEditPending) && (
                  <Button
                    size="sm"
                    variant={isAdmin ? 'default' : 'outline'}
                    onClick={() => onOpenReview(s.id)}
                  >
                    <Icon name={isAdmin ? 'ClipboardCheck' : 'Pencil'} size={14} className="mr-1.5" />
                    {isAdmin ? 'Проверить' : 'Изменить'}
                  </Button>
                )}
                {!isPending && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/crm/shipments/from-supplier/${s.id}`)}
                  >
                    <Icon name="Layers" size={14} className="mr-1.5" />
                    Рулоны · {s.itemsCount}
                  </Button>
                )}
                {isAdmin && !isPending && (
                  <Button
                    size="sm"
                    variant="outline"
                    className={
                      s.logisticsCost
                        ? undefined
                        : 'border-amber-400 text-amber-800 hover:bg-amber-50'
                    }
                    onClick={() => onOpenLogistics(s.id)}
                  >
                    <Icon name="Truck" size={14} className="mr-1.5" />
                    {s.logisticsCost
                      ? `${s.logisticsCost.toLocaleString('ru-RU')} ₽`
                      : 'Логистика'}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPrintAcceptanceSheet(s.id)}
                >
                  <Icon name="FileText" size={14} className="mr-1.5" />
                  Лист приёмки
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onPrintShipmentBarcodes(s.id)}
                >
                  <Icon name="Barcode" size={14} className="mr-1.5" />
                  Стикеры
                </Button>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onSetDeleteId(s.id)}
                  >
                    <Icon name="Trash2" size={14} />
                  </Button>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
};

export default SuppliesCards;
