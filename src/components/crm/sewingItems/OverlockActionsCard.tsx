import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { takeOverlock, overlockDone, type Order, type OrderDetail } from '@/lib/ordersApi';
import type { Roll } from '@/lib/rollsApi';
import { formatQuantity } from '@/lib/formatQuantity';

interface OverlockActionsCardProps {
  order: Order;
  orderDetail?: OrderDetail | null;
  /** Рулоны тесьмы, подходящие этому товару (4 см для оверлока / вуали без ут). */
  trimRolls?: Roll[];
  /** Кто нажимает: по нему сервер проверяет допуск и начисляет оплату за обмётку. */
  actorId?: number;
  /** Перезагрузить список после действия — вещь уходит на другую вкладку. */
  onDone: () => void;
  /**
   * Сколько ещё секунд обмётывать ЭТУ вещь. Пока идёт отсчёт, сдать её нельзя:
   * иначе швея за секунду «сдала» бы обе вещи и разобрала всю очередь обмётки,
   * а оверлок простаивал. 0 — можно сдавать.
   */
  overlockWaitSec?: number;
  /**
   * Оверлок занят ДРУГОЙ швеёй — её имя. Машина в цехе одна, и пока за ней
   * работают, брать вещи на обмётку нельзя. Показываем причину заранее, а не
   * отказом после нажатия.
   */
  overlockBusyBy?: string | null;
  /** Вещей на оверлоке у этой швеи и предел цеха — для замочка на кнопке. */
  overlockInWork?: number;
  maxOverlockOrders?: number;
  /** Админ может сдать обмётку за любую швею. */
  isAdmin?: boolean;
}

/**
 * Действия швеи на этапе оверлока.
 *
 * Вещь из ткани с осыпающимся краем сначала обмётывают и только потом отдают на
 * прямострочку. Отсюда два пути, и выбирает их сама швея за машинкой:
 *
 *  · «Передать на пошив» — частичная работа. Вещь возвращается в «Раскроено» с
 *    отметкой «Обработан на оверлоке», тесьму НЕ списываем — её укажет швея на
 *    прямострочке. Расход материала после обмётки не нужен.
 *  · «Завершить полностью» — швея дошила вещь сама. Тогда выбирает коробку с
 *    тесьмой и сдаёт сразу на стикеровку: тесьма списывается с рулона.
 */
const OverlockActionsCard = ({
  order,
  orderDetail = null,
  trimRolls = [],
  actorId,
  onDone,
  overlockWaitSec = 0,
  overlockBusyBy = null,
  overlockInWork = 0,
  maxOverlockOrders = 0,
  isAdmin = false,
}: OverlockActionsCardProps) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [selectedRollId, setSelectedRollId] = useState('');

  const taken = order.overlockUserId != null;
  const takenByOther = taken && !isAdmin && order.overlockUserId !== actorId;
  const meters = order.width ? (order.width / 100).toFixed(2) : null;
  const limitReached = maxOverlockOrders > 0 && overlockInWork >= maxOverlockOrders;
  const takeBlocked = !taken && (Boolean(overlockBusyBy) || limitReached);
  const waitLabel =
    overlockWaitSec >= 60
      ? `${Math.floor(overlockWaitSec / 60)} мин. ${overlockWaitSec % 60} сек.`
      : `${overlockWaitSec} сек.`;

  // Пока деталь грузится — не даём завершить без тесьмы: иначе уедет без списания.
  const detailReady = orderDetail != null;
  const trimNeeded = !detailReady || orderDetail?.requiredTrimMaterialId != null;
  const matchingRolls =
    orderDetail?.requiredTrimMaterialId != null
      ? trimRolls.filter((r) => r.materialId === orderDetail.requiredTrimMaterialId)
      : trimRolls;

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: okText });
      onDone();
    } catch (e) {
      toast({
        title: 'Не получилось',
        description: e instanceof Error ? e.message : 'Попробуйте ещё раз',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-fuchsia-300 bg-fuchsia-50/40 shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon name="Scissors" size={16} className="text-fuchsia-600" />
          Оверлок — обмётка края
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground"></p>

        {!taken && overlockBusyBy && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            За оверлоком работает <b>{overlockBusyBy}</b> — машина в цехе одна.
            Возьмите обычный заказ: обмётка освободится, когда она сдаст свои вещи.
          </div>
        )}
        {!taken && !overlockBusyBy && limitReached && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            У вас уже {overlockInWork} из {maxOverlockOrders} вещей на оверлоке —
            обметайте и передайте их дальше.
          </div>
        )}

        {!taken ? (
          <Button
            className="w-full bg-fuchsia-600 hover:bg-fuchsia-700"
            disabled={busy || takeBlocked}
            onClick={() => run(() => takeOverlock(order.id, actorId), 'Заказ взят на оверлок')}
          >
            {busy ? (
              <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
            ) : (
              <Icon name={takeBlocked ? 'Lock' : 'Hand'} size={16} className="mr-2" />
            )}
            {takeBlocked ? 'Оверлок занят' : 'Взять на оверлок'}
          </Button>
        ) : takenByOther ? (
          <div className="space-y-2">
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Эту вещь обмётывает другая швея — сдать её может только она. Если она
              закрыла смену, не сдав вещь, её можно забрать себе.
            </div>
            <Button
              variant="outline"
              className="w-full"
              disabled={busy}
              onClick={() => run(() => takeOverlock(order.id, actorId), 'Заказ взят на оверлок')}
            >
              <Icon name="Hand" size={16} className="mr-2" />
              Забрать себе
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {overlockWaitSec > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-fuchsia-300 bg-white px-3 py-2 text-xs text-fuchsia-900">
                <Icon name="Clock" size={14} />
                Можно сдать через <b>{waitLabel}</b>
              </div>
            )}

            {/* Частичная работа: только обмётка, тесьму не трогаем. */}
            <Button
              className="w-full bg-fuchsia-600 hover:bg-fuchsia-700"
              disabled={busy || overlockWaitSec > 0}
              onClick={() =>
                run(
                  () => overlockDone(order.id, 'to_sewing', actorId),
                  'Обметано, заказ передан на пошив'
                )
              }
            >
              {busy ? (
                <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
              ) : (
                <Icon name={overlockWaitSec > 0 ? 'Clock' : 'ArrowRight'} size={16} className="mr-2" />
              )}
              Передать на пошив
            </Button>
            <p className="text-xs text-muted-foreground">
              Частично: вещь вернётся в очередь «Раскроено», тесьму укажет швея на
              прямострочке. Расход материала после обмётки не нужен.
            </p>

            {/* Полное завершение: выбрать коробку с тесьмой и сдать на стикеровку. */}
            <div className="space-y-2 rounded-md border border-border bg-white p-3">
              <p className="text-xs font-medium">Завершить полностью — на стикеровку</p>
              {trimNeeded ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    Рулон тесьмы
                    {orderDetail?.requiredTrimMaterialName
                      ? ` «${orderDetail.requiredTrimMaterialName}»`
                      : ''}
                  </Label>
                  <Select
                    value={selectedRollId}
                    onValueChange={setSelectedRollId}
                    disabled={busy || overlockWaitSec > 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите коробку с тесьмой" />
                    </SelectTrigger>
                    <SelectContent>
                      {matchingRolls.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">
                          Нет доступных рулонов
                        </div>
                      ) : (
                        matchingRolls.map((r) => (
                          <SelectItem key={r.id} value={String(r.id)}>
                            {r.materialName} #{r.barcode} — {formatQuantity(r.remainingQuantity)}{' '}
                            {r.unit}
                            {r.foreignShift ? ' · материал чужой смены' : ''}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  {matchingRolls.length === 0 && (
                    <p className="text-xs text-amber-700">
                      В цехе нет рулонов нужной тесьмы. Попросите кладовщика передать
                      коробку — или передайте заказ на пошив без тесьмы.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Для этого товара тесьма не требуется.
                </p>
              )}
              <Button
                variant="outline"
                className="w-full"
                disabled={
                  busy ||
                  overlockWaitSec > 0 ||
                  (trimNeeded && !selectedRollId)
                }
                onClick={() =>
                  run(
                    () =>
                      overlockDone(
                        order.id,
                        'finish',
                        actorId,
                        selectedRollId ? Number(selectedRollId) : undefined,
                      ),
                    'Заказ завершён и отправлен на стикеровку'
                  )
                }
              >
                <Icon name="CheckCheck" size={16} className="mr-2" />
                Завершить полностью
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default OverlockActionsCard;