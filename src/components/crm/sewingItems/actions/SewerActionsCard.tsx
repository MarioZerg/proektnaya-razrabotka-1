import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import type { Order, OrderDetail } from '@/lib/ordersApi';
import type { Roll } from '@/lib/rollsApi';
import { formatWait, isOrderCancelled } from '@/components/crm/sewingItems/sewingItemsShared';
import { formatQuantity } from '@/lib/formatQuantity';

interface SewerActionsCardProps {
  selectedOrder: Order;
  orderDetail: OrderDetail | null;
  cutting: boolean;
  canSendToStickering: boolean;
  isAlreadyStickering: boolean;
  trimNeeded: boolean;
  matchingRolls: Roll[];
  selectedRollId: string;
  setSelectedRollId: (value: string) => void;
  onSendToStickering?: (rollId?: number) => void;
  sewWaitSec: number;
}

/** Блок швеи: выбор рулона тесьмы и кнопка «Отправить на стикеровку» с таймером пошива. */
const SewerActionsCard = ({
  selectedOrder,
  orderDetail,
  cutting,
  canSendToStickering,
  isAlreadyStickering,
  trimNeeded,
  matchingRolls,
  selectedRollId,
  setSelectedRollId,
  onSendToStickering,
  sewWaitSec,
}: SewerActionsCardProps) => {
  if (!canSendToStickering) {
    return (
      <Card className="border-border shadow-none">
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Icon name="Info" size={16} />
          Заказ уже в статусе «{selectedOrder?.sewingStatus}» — тесьму списывать не нужно.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border shadow-none">
      {/* ОТМЕНЁННАЯ ВЕЩЬ С ГОТОВЫМ КРОЕМ — ШЬЁМ КАК ОБЫЧНО.
          Швея видит красный бейдж «Отменён» и может решить, что работу делать
          не надо, а вещь бросить. Но крой уже сделан, ткань не вернуть: вещь
          дошивают и сдают на стикеровку, где ей печатают складской стикер. */}
      {isOrderCancelled(selectedOrder) && (
        <CardContent className="space-y-1.5 border-b border-amber-200 bg-amber-50 py-3">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <Icon name="TriangleAlert" size={16} className="shrink-0" />
            Заказ отменён покупателем — вещь всё равно дошиваем
          </p>
          <p className="text-sm text-amber-900">
            Ткань уже раскроена, обратно в рулон она не вернётся. Шейте и сдавайте
            на стикеровку как обычно: там вещи напечатают складской стикер, и она
            уедет на полку хранения вместо отправки покупателю.
          </p>
        </CardContent>
      )}
      <CardHeader className="pb-3">
        {/* break-words обязателен: название материала приходит из справочника
            и бывает длинным, а без переноса эта строка задаёт карточке
            минимальную ширину больше экрана телефона и уводит текст вправо. */}
        <CardTitle className="break-words text-sm">
          Выбор рулона тесьмы
          {orderDetail?.requiredTrimMaterialName && (
            <span className="ml-1 font-normal text-muted-foreground">
              — нужен материал «{orderDetail.requiredTrimMaterialName}»
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end gap-3">
        {trimNeeded ? (
          <div className="w-full space-y-1.5 sm:w-64">
            <Label>Рулон тесьмы в вашем цехе/смене</Label>
            <Select
              value={selectedRollId}
              onValueChange={setSelectedRollId}
              disabled={cutting || isAlreadyStickering}
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите рулон" />
              </SelectTrigger>
              <SelectContent>
                {matchingRolls.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет доступных рулонов</div>
                ) : (
                  matchingRolls.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.materialName} #{r.barcode} — {formatQuantity(r.remainingQuantity)} {r.unit}
                      {/* Материал завела другая смена: расход запишется как работа
                          за чужую смену, чтобы он не приписался её сотрудникам. */}
                      {r.foreignShift ? ' · материал чужой смены' : ''}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {/* Пустой список — тупик: швея не понимает, почему нельзя отправить заказ.
                Называем нужную тесьму, чтобы было с чем идти к кладовщику. */}
            {matchingRolls.length === 0 && (
              <p className="text-xs text-amber-700">
                В вашем цехе и смене нет рулонов
                {orderDetail?.requiredTrimMaterialName
                  ? ` «${orderDetail.requiredTrimMaterialName}»`
                  : ' нужной тесьмы'}
                . Попросите кладовщика передать рулон в цех.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Для этого товара тесьма не требуется — можно отправлять на стикеровку.
          </p>
        )}

        {/* ТАЙМЕР ПОШИВА. Пока он идёт, вещь сдать нельзя: время на неё задано
            настройками цеха по ширине и отсчитывается от взятия заказа. Так место
            в работе освобождается только реально отшитой вещью. Кнопка сама
            показывает остаток и разблокируется — обновлять страницу не нужно. */}
        <Button
          onClick={() => onSendToStickering?.(selectedRollId ? Number(selectedRollId) : undefined)}
          disabled={
            cutting || isAlreadyStickering || (trimNeeded && !selectedRollId) || sewWaitSec > 0
          }
        >
          {cutting ? (
            <>
              <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
              Списываем тесьму...
            </>
          ) : sewWaitSec > 0 ? (
            <>
              <Icon name="Timer" size={16} className="mr-2" />
              Можно сдать через {formatWait(sewWaitSec)}
            </>
          ) : (
            <>
              <Icon name="Tag" size={16} className="mr-2" />
              Отправить на стикеровку
            </>
          )}
        </Button>

        {sewWaitSec > 0 && (
          <p className="text-xs text-muted-foreground">
            Время на пошив этой вещи задано настройками цеха по её ширине. Кнопка
            откроется сама.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default SewerActionsCard;
