import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import Icon from '@/components/ui/icon';

interface StrategySettingsCardProps {
  marginMin: string;
  marginMax: string;
  stepPercent: string;
  stepDays: string;
  setMarginMin: (v: string) => void;
  setMarginMax: (v: string) => void;
  setStepPercent: (v: string) => void;
  setStepDays: (v: string) => void;
  busy: boolean;
  onSave: () => void;
}

/**
 * Правила, по которым считаются советы: коридор маржи, шаг цены и пауза.
 *
 * Шаг держим мелким намеренно: резкий подъём выбрасывает товар из скидки
 * площадки и из выдачи — потерять позицию легко, вернуть трудно.
 */
const StrategySettingsCard = ({
  marginMin,
  marginMax,
  stepPercent,
  stepDays,
  setMarginMin,
  setMarginMax,
  setStepPercent,
  setStepDays,
  busy,
  onSave,
}: StrategySettingsCardProps) => (
  <Card className="border-border shadow-none">
    <CardContent className="space-y-3 pt-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label>Маржа от, %</Label>
          <Input
            type="number"
            value={marginMin}
            onChange={(e) => setMarginMin(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Маржа до, %</Label>
          <Input
            type="number"
            value={marginMax}
            onChange={(e) => setMarginMax(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Шаг цены, %</Label>
          <Input
            type="number"
            step="0.5"
            value={stepPercent}
            onChange={(e) => setStepPercent(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Мелкий шаг бережёт СПП
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Пауза, дней</Label>
          <Input
            type="number"
            value={stepDays}
            onChange={(e) => setStepDays(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Между шагами по одному товару
          </p>
        </div>
      </div>
      <Button onClick={onSave} disabled={busy}>
        <Icon name="Check" size={16} className="mr-1.5" />
        Сохранить
      </Button>
    </CardContent>
  </Card>
);

export default StrategySettingsCard;
