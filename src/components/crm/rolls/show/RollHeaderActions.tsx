import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import type { RollDetail, RollStatus } from '@/lib/rollsApi';
import { formatQuantity } from '@/lib/formatQuantity';
import { printBarcodes } from '@/lib/printBarcodes';

const statusLabels: Record<RollStatus, { label: string; variant: 'secondary' | 'default' | 'outline' }> = {
  in_storage: { label: 'На складе', variant: 'secondary' },
  in_workshop: { label: 'В цехе', variant: 'default' },
  completed: { label: 'Завершён', variant: 'outline' },
};

interface RollHeaderActionsProps {
  roll: RollDetail['roll'];
  unit: string;
  isAdmin: boolean;
  canPrintSticker: boolean;
  onWriteOff: () => void;
  onMove: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

const RollHeaderActions = ({
  roll,
  unit,
  isAdmin,
  canPrintSticker,
  onWriteOff,
  onMove,
  onEdit,
  onRemove,
}: RollHeaderActionsProps) => (
  <div className="flex flex-wrap items-center gap-3">
    <h1 className="text-xl font-bold">Рулон #{roll.id}</h1>
    <span className="font-mono-tech text-sm text-muted-foreground">{roll.barcode}</span>
    <Badge variant={(statusLabels[roll.status] || { variant: 'outline' as const }).variant}>
      {(statusLabels[roll.status] || { label: roll.status }).label}
    </Badge>
    {/* Тип материала и кто отвечает за брак именно по нему: Тюль — закройщик,
        Аксессуары — швея, Упаковка — упаковщик. */}
    <Badge variant="outline">
      {roll.materialType || 'Тип не указан'}
      {roll.defectRoleLabel ? ` · брак: ${roll.defectRoleLabel}` : ''}
    </Badge>

    {/* Перепечатка стикера рулона: наклейка теряется и затирается на складе,
        а без штрихкода рулон не отсканировать при отгрузке в цех. Доступна
        кладовщикам и администратору — они работают с рулонами физически. */}
    {canPrintSticker && (
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          printBarcodes(
            [
              {
                code: roll.barcode,
                label: `${roll.materialName || ''} ${formatQuantity(roll.initialQuantity)} ${unit}`.trim(),
                supplier: roll.supplierName,
                receivedAt: roll.createdAt,
              },
            ],
            `Стикер рулона ${roll.barcode}`
          )
        }
      >
        <Icon name="Printer" size={14} className="mr-1" />
        Стикер рулона
      </Button>
    )}

    {/* Ручное списание метража: материал уходит не только в пошив —
        его продают, отрезают на образец, портят при перемотке. Без
        этой кнопки остаток в системе расходился с полкой, и понять
        причину можно было только на инвентаризации. */}
    {isAdmin && roll.remainingQuantity > 0 && (
      <Button
        size="sm"
        variant="outline"
        onClick={onWriteOff}
      >
        <Icon name="Minus" size={14} className="mr-1" />
        Списать метраж
      </Button>
    )}

    {/* ПЕРЕМЕЩЕНИЕ РУЛОНА. Рулон уехал в цех, а там не нужен — смену
        закрыли, заказ отменили. Или материал нужен соседней смене: раньше
        ради этого рулон «возвращали» на склад и тут же выдавали заново,
        хотя ткань физически не двигалась. Закрытый рулон не трогаем: его
        остаток обнулён и недостача уже посчитана. */}
    {isAdmin && roll.status !== 'completed' && (
      <Button size="sm" variant="outline" onClick={onMove}>
        <Icon name="ArrowRightLeft" size={14} className="mr-1" />
        {roll.status === 'in_workshop' ? 'Вернуть или передать' : 'Выдать в цех'}
      </Button>
    )}

    {/* ПРАВКА МЕТРАЖА. Бирки поставщика врут: на рулоне «50 м», по факту 47.
        Правим только целый рулон на складе — у тронутого за цифрой уже стоят
        чужие раскрои, списания и зарплата за работу. */}
    {isAdmin
      && roll.status === 'in_storage'
      && roll.remainingQuantity === roll.initialQuantity && (
      <Button size="sm" variant="outline" onClick={onEdit}>
        <Icon name="Pencil" size={14} className="mr-1" />
        Изменить метраж
      </Button>
    )}

    {/* УБРАТЬ РУЛОН. Завели ошибочно — дубль при разгрузке, опечатка,
        приёмка оформлена дважды. Рулон с раскроями система не отдаст:
        за ним стоит выполненная работа. */}
    {isAdmin && (
      <Button
        size="sm"
        variant="outline"
        className="text-destructive hover:bg-destructive/5 hover:text-destructive"
        onClick={onRemove}
      >
        <Icon name="Trash2" size={14} className="mr-1" />
        Убрать рулон
      </Button>
    )}
  </div>
);

export default RollHeaderActions;
