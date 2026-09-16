import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useNavigate } from 'react-router-dom';
import Icon from '@/components/ui/icon';
import type { Shipment } from '@/lib/shipmentsApi';
import { formatDate, statusVariant } from '@/components/crm/shipments/fromSupplierShared';
import { formatQuantity } from '@/lib/formatQuantity';
import SuppliesCards from '@/components/crm/shipments/SuppliesCards';

interface SuppliesTableProps {
  loading: boolean;
  shipments: Shipment[];
  isAdmin: boolean;
  /** Кладовщик: правит и печатает стикеры, но не подтверждает приёмку. */
  canEditPending: boolean;
  onOpenReview: (shipmentId: number) => void;
  /** Открыть окно ввода логистики: сумму перевозки дописывают после приёмки. */
  onOpenLogistics: (shipmentId: number) => void;
  onPrintShipmentBarcodes: (shipmentId: number) => void;
  deleteId: number | null;
  deleting: boolean;
  onSetDeleteId: (id: number | null) => void;
  onDelete: () => void;
}

const SuppliesTable = ({
  loading,
  shipments,
  isAdmin,
  canEditPending,
  onOpenReview,
  onOpenLogistics,
  onPrintShipmentBarcodes,
  deleteId,
  deleting,
  onSetDeleteId,
  onDelete,
}: SuppliesTableProps) => {
  const navigate = useNavigate();
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загрузка...
      </div>
    );
  }

  if (shipments.length === 0) {
    return <p className="text-sm text-muted-foreground">Приёмок пока нет</p>;
  }

  return (
    <>
      {/* На телефоне таблица из девяти колонок уезжала вбок вместе с кнопкой
          приёмки — там показываем карточки. */}
      <div className="md:hidden">
        <SuppliesCards
          shipments={shipments}
          isAdmin={isAdmin}
          canEditPending={canEditPending}
          onOpenReview={onOpenReview}
          onOpenLogistics={onOpenLogistics}
          onPrintShipmentBarcodes={onPrintShipmentBarcodes}
          onSetDeleteId={onSetDeleteId}
        />
      </div>

      {/* Таблица без горизонтальной прокрутки страницы.
          Раньше было девять колонок, и кнопки «Проверить» / стикеры уезжали
          за правый край — список приходилось двигать вправо. Связанные данные
          собраны в одну ячейку, таблица table-fixed занимает ширину экрана. */}
      <div className="hidden min-w-0 overflow-hidden rounded-md border border-border md:block">
        <Table className="min-w-0 table-fixed">
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="w-[26%] whitespace-normal text-primary-foreground">Приёмка</TableHead>
              <TableHead className="w-[16%] whitespace-normal text-primary-foreground">Статус</TableHead>
              <TableHead className="w-[22%] whitespace-normal text-primary-foreground">Поставщик</TableHead>
              <TableHead className="w-[14%] whitespace-normal text-primary-foreground">Сроки</TableHead>
              <TableHead className="w-[22%] whitespace-normal text-primary-foreground" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shipments.map((s) => {
              const isPending = s.status === 'Новый';
              return (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-normal break-words align-top">
                      <div className="font-semibold">#{s.id}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.itemsCount} поз. · {formatQuantity(s.totalQuantity)} метр/шт
                      </div>
                      {s.comment ? (
                        <div className="mt-1 break-words text-xs text-muted-foreground">
                          {s.comment}
                        </div>
                      ) : null}
                      {/* Раньше рулоны раскрывались мелкой гармошкой прямо в списке:
                          на 284 позиции это нечитаемо. Теперь ведём на страницу приёмки —
                          там поиск по штрихкоду и печать стикера по одному рулону. */}
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
                    </TableCell>
                    <TableCell className="whitespace-normal align-top">
                      <Badge variant={statusVariant[s.status] || 'secondary'} className="whitespace-normal">
                        {s.status === 'Новый' ? 'Ожидает подтверждения' : s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-normal break-words align-top">
                      <div>{s.itemSuppliers || s.supplierName || '—'}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {s.createdByName || '—'}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-normal align-top text-xs">
                      <div>{formatDate(s.createdAt)}</div>
                      <div className="mt-0.5 text-muted-foreground">
                        {s.completedAt ? formatDate(s.completedAt) : 'не принята'}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-0 align-top">
                      <div className="flex min-w-0 flex-wrap justify-end gap-1">
                        {/* Админ проверяет и подтверждает, кладовщик — правит свой же
                            состав, пока приёмку не приняли. */}
                        {isPending && (isAdmin || canEditPending) && (
                          <Button
                            size="sm"
                            className="px-2 lg:px-3"
                            variant={isAdmin ? 'default' : 'outline'}
                            title={isAdmin ? 'Проверить' : 'Изменить'}
                            onClick={() => onOpenReview(s.id)}
                          >
                            <Icon
                              name={isAdmin ? 'ClipboardCheck' : 'Pencil'}
                              size={14}
                              className="lg:mr-1"
                            />
                            <span className="hidden lg:inline">
                              {isAdmin ? 'Проверить' : 'Изменить'}
                            </span>
                          </Button>
                        )}
                        {/* ЛОГИСТИКА. Счёт за машину приходит позже самой машины, и
                            сумму почти всегда дописывают потом. Раньше за этим нужно
                            было открыть приёмку, найти рулоны и уже там заметить жёлтую
                            плашку — про неё просто не знали. Теперь видно из списка:
                            пропущенная логистика подсвечена и правится в один клик. */}
                        {isAdmin && !isPending && !s.logisticsCost && (
                          <Button
                            size="icon"
                            variant="outline"
                            className="border-amber-400 text-amber-800 hover:bg-amber-50"
                            title="Логистика не указана — себестоимость метра занижена"
                            onClick={() => onOpenLogistics(s.id)}
                          >
                            <Icon name="Truck" size={14} />
                          </Button>
                        )}
                        {isAdmin && !isPending && !!s.logisticsCost && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title={`Логистика: ${s.logisticsCost.toLocaleString('ru-RU')} ₽`}
                            onClick={() => onOpenLogistics(s.id)}
                          >
                            <Icon name="Truck" size={14} />
                          </Button>
                        )}
                        {/* Печать стикеров доступна сразу: коды выдаются при оформлении,
                            и кладовщик клеит их прямо при разгрузке машины. */}
                        <Button
                          variant="outline"
                          size="icon"
                          title="Печать стикеров рулонов (75×120 мм)"
                          onClick={() => onPrintShipmentBarcodes(s.id)}
                        >
                          <Icon name="Barcode" size={14} />
                        </Button>
                        {isAdmin && (
                          <Button variant="ghost" size="icon" onClick={() => onSetDeleteId(s.id)}>
                            <Icon name="Trash2" size={14} />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && onSetDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить приёмку от поставщика?</AlertDialogTitle>
            <AlertDialogDescription>
              Если поставка уже подтверждена — созданные рулоны удалятся вместе с ней, но
              только если они ещё не использованы (не списаны, не переданы в цех). Если хотя
              бы один рулон уже тронут — удаление будет отклонено. Действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} disabled={deleting}>
              {deleting ? 'Удаление...' : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default SuppliesTable;