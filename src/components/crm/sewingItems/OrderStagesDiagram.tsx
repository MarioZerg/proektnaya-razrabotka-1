import Icon from '@/components/ui/icon';
import type { Order } from '@/lib/ordersApi';
import { shortFio } from '@/components/crm/sewingItems/sewingItemsShared';

interface OrderStagesDiagramProps {
  order: Order;
}

interface Stage {
  label: string;
  userName: string | null;
  /** ID сотрудника для этапа кроя — по нему швея находит крой закройщика на вешалках. */
  userId?: number | null;
}

/** Вертикальная диаграмма-очередь "Кроил → Сшил → Упаковал" в одной колонке: пройденные
 * этапы — с именем сотрудника и зелёной галочкой, будущие — приглушённые с точкой. У этапа
 * кроя дополнительно показывается ID закройщика — так швея находит его крой на вешалках. */
const OrderStagesDiagram = ({ order }: OrderStagesDiagramProps) => {
  const stages: Stage[] = [
    { label: 'Кроил', userName: order.cutterUserName, userId: order.cutterUserId },
    { label: 'Сшил', userName: order.sewerUserName },
    { label: 'Упаковал', userName: order.packerUserName },
  ];

  return (
    <div className="space-y-1">
      {stages.map((stage, idx) => {
        const done = !!stage.userName;
        return (
          <div key={stage.label} className="flex items-center gap-1.5">
            <Icon
              name={done ? 'CheckCircle2' : 'Circle'}
              size={13}
              className={done ? 'shrink-0 text-emerald-600' : 'shrink-0 text-muted-foreground/40'}
            />
            <span className={`whitespace-nowrap text-xs ${done ? 'text-foreground' : 'text-muted-foreground/60'}`}>
              {stage.label}
              {done && <span className="font-medium">: {shortFio(stage.userName!)}</span>}
              {done && stage.userId != null && (
                <span className="ml-1 rounded bg-blue-100 px-1 font-semibold text-blue-700">ID: {stage.userId}</span>
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