import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Icon from '@/components/ui/icon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import {
  saveManagerCommission,
  type ManagerCommission,
} from '@/lib/productCostApi';

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const monthLabel = (iso: string) => {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
};

const money = (v: number) => Math.round(v).toLocaleString('ru-RU');

interface Props {
  manager: ManagerCommission;
  onChanged: () => void;
}

/**
 * Вознаграждение менеджера маркетплейсов.
 *
 * Менеджер получает процент с поступлений по отчётам площадок. Раньше сумму
 * сводили вручную, проверить её было нечем, а в себестоимость товара расход
 * не попадал вовсе — хотя на каждой вещи он заметен.
 *
 * База — НАЧИСЛЕННОЕ по отчёту, а не пришедшее на счёт. Эти суммы расходятся,
 * когда мы берём досрочную выплату: площадка удерживает её из перевода. Но
 * досрочная выплата — наше решение по деньгам, а не результат работы
 * менеджера, поэтому вознаграждение из-за неё не урезается.
 */
const ManagerCommissionPanel = ({ manager, onChanged }: Props) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [percent, setPercent] = useState(String(manager.percent));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await saveManagerCommission({
        percent: Number(percent) || 0,
        isActive: manager.isActive,
        comment: manager.comment || '',
        actorId: user?.id,
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      toast({
        title: 'Не удалось сохранить',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <Icon name="UserRoundCheck" size={15} />
          Менеджер маркетплейсов
          {manager.perUnit != null && (
            <Badge variant="secondary">+{manager.perUnit} ₽ на каждую вещь</Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Процент с денег, пришедших на счёт за {monthLabel(manager.month)} ·{' '}
          {manager.periods} отчётов
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Перечислено на расчётный счёт
            </span>
            <span className="font-mono-tech">{money(manager.transferred)} ₽</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-1.5">
            <span className="flex items-center gap-2">
              Ставка
              {editing ? (
                <span className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    step="0.1"
                    min={0}
                    max={50}
                    value={percent}
                    onChange={(e) => setPercent(e.target.value)}
                    className="h-8 w-20"
                  />
                  <span className="text-muted-foreground">%</span>
                  <Button size="sm" className="h-8" onClick={save} disabled={saving}>
                    Сохранить
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      setPercent(String(manager.percent));
                      setEditing(false);
                    }}
                  >
                    Отмена
                  </Button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                >
                  {manager.percent}%
                  <Icon name="Pencil" size={12} />
                </button>
              )}
            </span>
          </div>
          <div className="mt-1.5 flex justify-between border-t border-border pt-1.5 font-bold">
            <span>К выплате менеджеру</span>
            <span>{money(manager.payout)} ₽</span>
          </div>
        </div>

        {/* Досрочные выплаты показываем ОТДЕЛЬНО и явно говорим, что на
            вознаграждение они не влияют: иначе при сверке возникает вопрос,
            почему процент считается не от суммы на выписке. */}
        {manager.earlyPayout > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Icon name="Info" size={13} className="mt-0.5 shrink-0" />
            Досрочными выплатами удержано {money(manager.earlyPayout)} ₽ — на
            счёт пришло меньше начисленного. На вознаграждение менеджера это не
            влияет: процент считается от начисленного по отчёту
          </p>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            База — деньги, фактически пришедшие на расчётный счёт по отчётам
            площадки. Расчётный итог отчёта ({money(manager.accrued)} ₽) больше:
            в нём сидит агентское вознаграждение — техническая проводка, а не
            перевод
          </Label>
        </div>
      </CardContent>
    </Card>
  );
};

export default ManagerCommissionPanel;
