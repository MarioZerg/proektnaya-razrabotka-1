import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { takeOverlock, overlockDone, type Order } from '@/lib/ordersApi';

interface OverlockActionsCardProps {
  order: Order;
  /** Кто нажимает: по нему сервер проверяет допуск и начисляет оплату за обмётку. */
  actorId?: number;
  /** Перезагрузить список после действия — вещь уходит на другую вкладку. */
  onDone: () => void;
  /**
   * Сколько ещё секунд обмётывать ЭТУ вещь. Пока идёт отсчёт, сдать её нельзя:
   * иначе швея за секунду «сдала» бы обе вещи и разобрала всю очередь обмётки,
   * а оверлок простаивал бы. 0 — можно сдавать.
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
}

/**
 * Действия швеи на этапе оверлока.
 *
 * Вещь из ткани с осыпающимся краем сначала обмётывают и только потом отдают на
 * прямострочку. Отсюда два пути, и выбирает их сама швея за машинкой:
 *
 *  · «Передать на пошив» — обычный случай. Вещь возвращается в общую очередь
 *    «Раскроено» с отметкой «Обработан на оверлоке», и её разбирает следующая
 *    свободная швея в порядке очереди.
 *  · «Завершить полностью» — работы по вещи больше нет. Тогда она минует
 *    прямострочку и уходит сразу на стикеровку.
 *
 * Оплата за обмётку считается сама, по ширине вещи, — швее ничего указывать не нужно.
 */
const OverlockActionsCard = ({
  order,
  actorId,
  onDone,
  overlockWaitSec = 0,
  overlockBusyBy = null,
  overlockInWork = 0,
  maxOverlockOrders = 0,
}: OverlockActionsCardProps) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const taken = order.overlockUserId != null;
  const meters = order.width ? (order.width / 100).toFixed(2) : null;
  // Замочек на взятии: либо за машиной уже кто-то сидит, либо у самой швеи
  // на руках предельное число вещей.
  const limitReached = maxOverlockOrders > 0 && overlockInWork >= maxOverlockOrders;
  const takeBlocked = !taken && (Boolean(overlockBusyBy) || limitReached);
  const waitLabel =
    overlockWaitSec >= 60
      ? `${Math.floor(overlockWaitSec / 60)} мин. ${overlockWaitSec % 60} сек.`
      : `${overlockWaitSec} сек.`;

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
        <p className="text-xs text-muted-foreground">
          У этой ткани осыпается край: сначала обмётка, потом прямострочка.
          {meters && ` Оплата за ${meters} пог.м.`}
        </p>

        {/* ОВЕРЛОК В ЦЕХЕ ОДИН — И ЭТО ВИДНО ДО НАЖАТИЯ.
            Раньше швея жала кнопку и получала отказ; теперь сразу понимает, что
            машина занята, и спокойно берёт обычный заказ вместо ожидания. */}
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
        ) : (
          <div className="space-y-2">
            {/* Таймер обмётки: пока он идёт, сдать вещь нельзя. Свой, отдельный от
                таймера пошива, — это разные этапы одной вещи. */}
            {overlockWaitSec > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-fuchsia-300 bg-white px-3 py-2 text-xs text-fuchsia-900">
                <Icon name="Clock" size={14} />
                Можно сдать через <b>{waitLabel}</b>
              </div>
            )}
            {/* Обычный путь стоит первым и выделен цветом: почти всегда вещь после
                обмётки уходит другой швее на прямострочку. */}
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
            <Button
              variant="outline"
              className="w-full"
              disabled={busy || overlockWaitSec > 0}
              onClick={() =>
                run(
                  () => overlockDone(order.id, 'finish', actorId),
                  'Заказ завершён и отправлен на стикеровку'
                )
              }
            >
              <Icon name="CheckCheck" size={16} className="mr-2" />
              Завершить полностью — на стикеровку
            </Button>
            <p className="text-xs text-muted-foreground">
              «Передать на пошив» — вещь вернётся в общую очередь, её дошьёт следующая
              швея. «Завершить полностью» — если по вещи работы больше нет.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default OverlockActionsCard;