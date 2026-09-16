import { useMemo, useState } from 'react';
import RobotRunsList from '@/components/crm/promotion/RobotRunsList';
import RobotManualMove from '@/components/crm/promotion/RobotManualMove';
import RobotAdviceCard from '@/components/crm/promotion/RobotAdviceCard';
import Icon from '@/components/ui/icon';
import type { RobotStatus } from '@/lib/priceRobotApi';
import type { PriceAdvice } from '@/lib/promotionApi';

interface RobotTabPanelProps {
  robot: RobotStatus | null;
  /** Советы по ценам этой площадки; null — ещё считаются. */
  advice: PriceAdvice[] | null;
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
  advice,
  busy,
  onRaise,
  moveProgress,
}: RobotTabPanelProps) => {
  const [onlyAdvice, setOnlyAdvice] = useState(false);

  // Какие карточки система советует поднять — по ним фильтруется таблица.
  const raiseIds = useMemo(
    () => new Set((advice || []).filter((i) => i.action === 'raise').map((i) => i.itemId)),
    [advice],
  );

  const catalog = useMemo(() => {
    const all = robot?.catalog || [];
    if (!onlyAdvice || raiseIds.size === 0) return all;
    return all.filter((i) => raiseIds.has(i.itemId));
  }, [robot, onlyAdvice, raiseIds]);

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

      <RobotAdviceCard
        advice={advice}
        onlyAdvice={onlyAdvice}
        onOnlyAdviceChange={setOnlyAdvice}
      />

      <RobotManualMove
        key={onlyAdvice ? 'advice' : 'all'}
        catalog={catalog}
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