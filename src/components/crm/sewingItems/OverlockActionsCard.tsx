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
const OverlockActionsCard = ({ order, actorId, onDone }: OverlockActionsCardProps) => {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const taken = order.overlockUserId != null;
  const meters = order.width ? (order.width / 100).toFixed(2) : null;

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

        {!taken ? (
          <Button
            className="w-full bg-fuchsia-600 hover:bg-fuchsia-700"
            disabled={busy}
            onClick={() => run(() => takeOverlock(order.id, actorId), 'Заказ взят на оверлок')}
          >
            {busy ? (
              <Icon name="Loader2" size={16} className="mr-2 animate-spin" />
            ) : (
              <Icon name="Hand" size={16} className="mr-2" />
            )}
            Взять на оверлок
          </Button>
        ) : (
          <div className="space-y-2">
            {/* Обычный путь стоит первым и выделен цветом: почти всегда вещь после
                обмётки уходит другой швее на прямострочку. */}
            <Button
              className="w-full bg-fuchsia-600 hover:bg-fuchsia-700"
              disabled={busy}
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
                <Icon name="ArrowRight" size={16} className="mr-2" />
              )}
              Передать на пошив
            </Button>
            <Button
              variant="outline"
              className="w-full"
              disabled={busy}
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
