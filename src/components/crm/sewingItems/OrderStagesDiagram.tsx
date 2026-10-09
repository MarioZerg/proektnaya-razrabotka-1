import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';
import {
  isOnOverlock,
  orderCutterName,
  orderCutterUserId,
  shortFio,
} from '@/components/crm/sewingItems/sewingItemsShared';

interface OrderStagesDiagramProps {
  order: Order;
}

interface Stage {
  label: string;
  userName: string | null;
  /** ID сотрудника для этапа кроя — по нему швея находит крой закройщика на вешалках. */
  userId?: number | null;
  /** Сейчас делает этот этап, ещё не закрыл. */
  current: boolean;
}

const stageOf = (order: Order): Stage[] => {
  const cuttingNow = order.sewingStatus === 'На раскрое';
  const sewingNow = order.sewingStatus === 'В работе' || isOnOverlock(order);
  const packingNow = order.sewingStatus === 'Стикеровка';
  const cutterDone = orderCutterName(order);
  const sewerDone = order.sewerUserName;
  const packerDone = order.packerUserName;
  const overlockName = order.overlockUserName;

  return [
    {
      label: 'Кроил',
      userName: cutterDone || (cuttingNow ? order.assignedUserName : null),
      userId: orderCutterUserId(order) || (cuttingNow ? order.assignedUserId : null),
      current: cuttingNow && !cutterDone,
    },
    {
      label: 'Сшил',
      userName:
        sewerDone ||
        (sewingNow ? order.assignedUserName || overlockName || null : null),
      current: sewingNow && !sewerDone,
    },
    {
      label: 'Упаковал',
      userName: packerDone || (packingNow ? order.assignedUserName : null),
      current: packingNow && !packerDone,
    },
  ];
};

/** Только этапы, на которых уже есть сотрудник: пустые «Сшил / Упаковал»
 * не рисуем, пока заказ туда не дошёл. */
const OrderStagesDiagram = ({ order }: OrderStagesDiagramProps) => {
  const stages = stageOf(order).filter((stage) => !!stage.userName);
  if (stages.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {stages.map((stage, idx) => {
        const live = stage.current;
        return (
          <div key={stage.label} className="flex items-center gap-1.5">
            <Icon
              name={live ? 'CircleDot' : 'CheckCircle2'}
              size={13}
              className={live ? 'shrink-0 text-sky-600' : 'shrink-0 text-emerald-600'}
            />
            <span className="whitespace-nowrap text-[11px] leading-tight text-foreground">
              {stage.label}
              <span className="font-medium">: {shortFio(stage.userName!)}</span>
              {live && <span className="ml-1 text-sky-700">сейчас</span>}
              {!live && stage.userId != null && (
                <span className="ml-1 rounded bg-blue-100 px-1 font-semibold text-blue-700">
                  ID: {stage.userId}
                </span>
              )}
            </span>
            {idx < stages.length - 1 && <span className="sr-only">→</span>}
          </div>
        );
      })}
    </div>
  );
};

export default OrderStagesDiagram;
