import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import Icon from '@/components/ui/icon';
import type { RobotSettings } from '@/lib/priceRobotApi';

/**
 * Настройки робота подъёма цен.
 *
 * Автоматика по спросу убрана: она откатывала цены, когда выгрузка продаж
 * отставала и в базе за вчера стоял ноль. Цены двигает только владелец
 * кнопкой; здесь задаётся цель и предел, дальше которого подъём не уйдёт
 * шаг назад и ждёт.
 *
 * Робот меняет цены на витрине сам, поэтому здесь два переключателя, а не
 * один: «включён» и «наблюдение». В наблюдении он считает и пишет в журнал,
 * что сделал бы, но витрину не трогает — так владелец видит его решения
 * несколько циклов, прежде чем доверить магазин.
 */
interface Props {
  value: RobotSettings;
  onChange: (v: RobotSettings) => void;
  onSave: () => void;
  busy: boolean;
}

const RobotSettingsCard = ({ value, onChange, onSave, busy }: Props) => {
  const set = <K extends keyof RobotSettings>(k: K, v: RobotSettings[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        {/* ГЛАВНЫЕ ТУМБЛЕРЫ. Наблюдение — предохранитель: пока он включён,
            цены на витрине в безопасности при любых настройках. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
            <Switch
              checked={value.isActive}
              onCheckedChange={(v) => set('isActive', v)}
            />
            <span className="text-sm">
              <span className="font-medium">Робот включён</span>
              <span className="block text-xs text-muted-foreground">
                Запускается сам каждую ночь
              </span>
            </span>
          </label>

          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
              value.dryRun
                ? 'border-amber-300 bg-amber-50'
                : 'border-rose-300 bg-rose-50'
            }`}
          >
            <Switch
              checked={value.dryRun}
              onCheckedChange={(v) => set('dryRun', v)}
            />
            <span className="text-sm">
              <span className="font-medium">
                {value.dryRun ? 'Наблюдение' : 'Боевой режим'}
              </span>
              <span className="block text-xs text-muted-foreground">
                {value.dryRun
                  ? 'Только считает, цены не меняет'
                  : 'Меняет реальные цены на витрине'}
              </span>
            </span>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Шаг цены, %</Label>
            <Input
              type="number"
              step="0.1"
              value={value.stepPercent}
              onChange={(e) => set('stepPercent', Number(e.target.value))}
            />
            <p className="text-[11px] text-muted-foreground">
              Мелкий шаг бережёт скидку площадки
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Раз в сколько дней</Label>
            <Input
              type="number"
              value={value.stepDays}
              onChange={(e) => set('stepDays', Number(e.target.value))}
            />
            <p className="text-[11px] text-muted-foreground">
              Нужно накопить продажи для сравнения
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Час запуска, МСК</Label>
            <Input
              type="number"
              min={0}
              max={23}
              value={value.runHour}
              onChange={(e) => set('runHour', Number(e.target.value))}
            />
            <p className="text-[11px] text-muted-foreground">
              Ночью витрина спокойнее
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Цель — поднять на, %</Label>
            <Input
              type="number"
              step="0.5"
              value={value.targetTotalPercent}
              onChange={(e) =>
                set('targetTotalPercent', Number(e.target.value))
              }
            />
            <p className="text-[11px] text-muted-foreground">
              Дошли — робот остановится сам
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Предел от старта, %</Label>
            <Input
              type="number"
              value={value.maxTotalPercent}
              onChange={(e) => set('maxTotalPercent', Number(e.target.value))}
            />
            <p className="text-[11px] text-muted-foreground">
              Дальше этого робот не уйдёт
            </p>
          </div>
        </div>


        {/* Предупреждение только в боевом режиме: в наблюдении пугать нечем. */}
        {!value.dryRun && value.isActive && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm">
            <Icon
              name="TriangleAlert"
              size={16}
              className="mt-0.5 shrink-0 text-rose-700"
            />
            <p className="text-rose-900">
              Робот будет менять цены всего магазина без подтверждения. Каждый
              шаг виден в журнале ниже
            </p>
          </div>
        )}

        <Button onClick={onSave} disabled={busy}>
          <Icon name="Check" size={16} className="mr-1.5" />
          Сохранить настройки
        </Button>
      </CardContent>
    </Card>
  );
};

export default RobotSettingsCard;
