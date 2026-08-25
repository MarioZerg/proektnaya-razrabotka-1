import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import RobotSettingsCard from '@/components/crm/promotion/RobotSettingsCard';
import RobotRunsList from '@/components/crm/promotion/RobotRunsList';
import RobotManualMove from '@/components/crm/promotion/RobotManualMove';
import type { RobotSettings, RobotStatus } from '@/lib/priceRobotApi';

interface RobotTabPanelProps {
  robot: RobotStatus | null;
  busy: boolean;
  onSettingsChange: (settings: RobotSettings) => void;
  onSave: () => void;
  onMove: (step: number, note: string) => void;
  onRun: () => void;
}

/**
 * Вкладка «Робот цен»: сводка по подъёму, настройки, ручной сдвиг и журнал.
 *
 * Робот поднимает цены всего магазина сам, мелкими шагами с паузой, и
 * останавливается, когда маржа дошла до цели. Здесь видно, где он сейчас на
 * этом пути и что делал на прошлых шагах.
 */
const RobotTabPanel = ({
  robot,
  busy,
  onSettingsChange,
  onSave,
  onMove,
  onRun,
}: RobotTabPanelProps) => {
  if (!robot?.settings) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Icon name="Loader2" size={16} className="animate-spin" />
        Загружаем робота…
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Главная цифра: сколько прошли из заданного подъёма. */}
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">
            Путь к цели
          </p>
          <p
            className={`text-2xl font-bold ${
              robot.driftPercent >= robot.settings.targetTotalPercent
                ? 'text-emerald-700'
                : 'text-amber-700'
            }`}
          >
            {robot.driftPercent > 0 ? '+' : ''}
            {robot.driftPercent}%
          </p>
          <p className="text-xs text-muted-foreground">
            цель +{robot.settings.targetTotalPercent}%
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">Состояние</p>
          <p className="text-2xl font-bold">
            {!robot.settings.isActive
              ? 'Выключен'
              : robot.settings.dryRun
                ? 'Наблюдает'
                : 'Работает'}
          </p>
          <p className="text-xs text-muted-foreground">
            {robot.settings.isActive
              ? `в ${robot.settings.runHour}:00 МСК, раз в ${robot.settings.stepDays} дн.`
              : 'шаги не делаются'}
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">
            Откат при падении
          </p>
          <p className="text-2xl font-bold">
            −{robot.settings.dropPercent}%
          </p>
          <p className="text-xs text-muted-foreground">
            спроса — вернём цену
          </p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted-foreground">
            Товаров под управлением
          </p>
          <p className="text-2xl font-bold">{robot.itemsCount}</p>
          <p className="text-xs text-muted-foreground">
            шаг {robot.settings.stepPercent}%
          </p>
        </div>
      </div>

      <RobotSettingsCard
        value={robot.settings}
        onChange={onSettingsChange}
        onSave={onSave}
        busy={busy}
      />

      <RobotManualMove
        onMove={onMove}
        busy={busy}
        dryRun={robot.settings.dryRun}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Журнал шагов</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={onRun}
          disabled={busy}
        >
          <Icon
            name={busy ? 'Loader2' : 'Play'}
            size={14}
            className={`mr-1.5 ${busy ? 'animate-spin' : ''}`}
          />
          Прогнать сейчас
        </Button>
      </div>
      <RobotRunsList runs={robot.runs} />
    </>
  );
};

export default RobotTabPanel;
