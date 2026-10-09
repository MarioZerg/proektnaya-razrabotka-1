import { Switch } from '@/components/ui/switch';
import Icon from '@/components/ui/icon';

interface ConveyorIssueSwitchProps {
  enabled: boolean;
  saving: boolean;
  onToggle: (enabled: boolean) => void;
}

/**
 * Рубильник выдачи заказов на главной у администратора.
 *
 * Выключил — закройщик, швея и оверлок не получают новые заказы, пока не
 * включат снова. Уже взятую работу (раскрой, пошив, стикеровку) не трогает.
 */
const ConveyorIssueSwitch = ({ enabled, saving, onToggle }: ConveyorIssueSwitchProps) => (
  <div
    className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${
      enabled
        ? 'border-border bg-card'
        : 'border-amber-300 bg-amber-50 text-amber-950'
    }`}
  >
    <div className="min-w-0">
      <div className="flex items-center gap-2 font-semibold">
        <Icon name={enabled ? 'Play' : 'Pause'} size={18} />
        Выдача заказов
      </div>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {enabled
          ? 'Конвейер выдаёт стек, пошив и оверлок как обычно'
          : 'Конвейер выключен — сотрудники не могут взять заказ'}
      </p>
    </div>
    <Switch
      checked={enabled}
      disabled={saving}
      onCheckedChange={onToggle}
      aria-label="Выдача заказов с конвейера"
    />
  </div>
);

export default ConveyorIssueSwitch;
