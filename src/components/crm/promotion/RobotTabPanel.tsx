import RobotRunsList from '@/components/crm/promotion/RobotRunsList';
import RobotManualMove from '@/components/crm/promotion/RobotManualMove';
import Icon from '@/components/ui/icon';
import type { RobotStatus } from '@/lib/priceRobotApi';

interface RobotTabPanelProps {
  robot: RobotStatus | null;
  busy: boolean;
  onRaise: (
    step: number,
    note: string,
    itemIds: number[] | undefined,
    scope: string,
  ) => void;
  moveProgress?: string | null;
}

/**
 * Подъём цен: фильтр по товарам и ширине, кнопка и журнал.
 *
 * Автоматики нет — цены едут только от нажатия. Настройки «включён / боевой
 * режим / раз в N дней» больше не нужны: расписания нет.
 */
const RobotTabPanel = ({
  robot,
  busy,
  onRaise,
  moveProgress,
}: RobotTabPanelProps) => {
  if (!robot) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загружаем ассортимент…
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">Карточек с ценой</p>
          <p className="text-2xl font-bold">{robot.catalog.length}</p>
          <p className="text-xs text-muted-foreground">на этой площадке</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">В очереди на отправку</p>
          <p className="text-2xl font-bold">{robot.pendingLeft}</p>
          <p className="text-xs text-muted-foreground">
            {robot.pendingLeft > 0 ? 'досылаем предыдущий подъём' : 'очередь пуста'}
          </p>
        </div>
      </div>

      <RobotManualMove
        catalog={robot.catalog}
        onRaise={onRaise}
        busy={busy}
        progress={moveProgress}
        maxStep={robot.maxStepPercent}
        pendingLeft={robot.pendingLeft}
      />

      <h2 className="font-semibold">Журнал подъёмов</h2>
      <RobotRunsList runs={robot.runs} />
    </>
  );
};

export default RobotTabPanel;
