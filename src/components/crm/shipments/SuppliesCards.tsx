import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import type { Shipment } from '@/lib/shipmentsApi';
import { formatDate, statusVariant } from '@/components/crm/shipments/fromSupplierShared';
import { formatQuantity } from '@/lib/formatQuantity';

interface SuppliesCardsProps {
  shipments: Shipment[];
  isAdmin: boolean;
  canEditPending: boolean;
  onOpenReview: (shipmentId: number) => void;
  /** Открыть окно ввода логистики: сумму перевозки дописывают после приёмки. */
  onOpenLogistics: (shipmentId: number) => void;
  onPrintShipmentBarcodes: (shipmentId: number) => void;
  onSetDeleteId: (id: number | null) => void;
}

/**
 * Мобильный вид списка приёмок от поставщика. Таблица на 9 колонок на телефоне
 * уезжала вбок вместе с кнопкой «Проверить» — её просто не было видно.
 * Здесь всё в столбик, действия внизу карточки и всегда на экране.
 */
const SuppliesCards = ({
  shipments,
  isAdmin,
  canEditPending,
  onOpenReview,
  onOpenLogistics,
  onPrintShipmentBarcodes,
  onSetDeleteId,
}: SuppliesCardsProps) => {
  const navigate = useNavigate();

  return (
    <div className="space-y-3">
      {shipments.map((s) => {
        const isPending = s.status === 'Новый';
        return (
          <div key={s.id} className="rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">Приёмка #{s.id}</div>
                <div className="text-xs text-muted-foreground">
                  {s.itemsCount} поз., {formatQuantity(s.totalQuantity)} метр/шт
                </div>
              </div>
              <Badge variant={statusVariant[s.status] || 'secondary'} className="shrink-0">
                {isPending ? 'Ожидает подтверждения' : s.status}
              </Badge>
            </div>

            <div className="mt-2 space-y-1 text-sm">
              <div className="break-words">
                <span className="text-muted-foreground">Поставщик: </span>
                {s.itemSuppliers || s.supplierName || '—'}
              </div>
              <div>
                <span className="text-muted-foreground">Кладовщик: </span>
                {s.createdByName || '—'}
              </div>
              <div>
                <span className="text-muted-foreground">Создано: </span>
                {formatDate(s.createdAt)}
              </div>
              {s.completedAt && (
                <div>
                  <span className="text-muted-foreground">Принято: </span>
                  {formatDate(s.completedAt)}
                </div>
              )}
              {s.comment && (
                <div className="break-words">
                  <span className="text-muted-foreground">Комментарий: </span>
                  {s.comment}
                </div>
              )}
            </div>

            {!isPending && (
              <Button
                variant="link"
                size="sm"
                className="mt-1 h-auto px-0 py-0 text-xs"
                onClick={() => navigate(`/crm/shipments/from-supplier/${s.id}`)}
              >
                <Icon name="ChevronRight" size={12} className="mr-1" />
                Открыть рулоны ({s.itemsCount})
              </Button>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {isPending && (isAdmin || canEditPending) && (
                <Button
                  size="sm"
                  className="flex-1"
                  variant={isAdmin ? 'default' : 'outline'}
                  onClick={() => onOpenReview(s.id)}
                >
                  <Icon name={isAdmin ? 'ClipboardCheck' : 'Pencil'} size={14} className="mr-1" />
                  {isAdmin ? 'Проверить и принять' : 'Изменить'}
                </Button>
              )}
              {/* Логистику дописывают после приёмки: счёт за машину приходит позже.
                  Пропущенную подсвечиваем — без неё себестоимость метра занижена. */}
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
                  <Icon name="Truck" size={14} className="mr-1" />
                  {s.logisticsCost
                    ? `${s.logisticsCost.toLocaleString('ru-RU')} ₽`
                    : 'Логистика'}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPrintShipmentBarcodes(s.id)}
              >
                <Icon name="Barcode" size={14} className="mr-1" />
                Стикеры
              </Button>
              {isAdmin && (
                <Button variant="ghost" size="icon" onClick={() => onSetDeleteId(s.id)}>
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

export default SuppliesCards;