import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  fetchMaterialPlan,
  joinAction,
  type PlanAction,
} from '@/lib/promotionApi';
import { money } from './economicsShared';

/**
 * План продвижения по всему материалу.
 *
 * Решение о скидках принимается по материалу целиком: у «Бамбука» полтора
 * десятка ширин и сотня размеров, и заводить их по одному — работа на день.
 *
 * Акции идут в порядке очерёдности — сначала та, где скидка обходится дешевле
 * всего. После каждой видно, какой станет средняя маржа по ассортименту, и как
 * только она опускается ниже порога, остальные помечаются «стоп».
 */
interface Props {
  /** Материал целиком: все ширины и высоты. */
  material: string;
  onDone: () => void;
}

const PromotePlan = ({ material, onDone }: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [minAvg, setMinAvg] = useState('4.5');
  const [plan, setPlan] = useState<PlanAction[]>([]);
  const [base, setBase] = useState<{ margin: number; sizes: number }>({
    margin: 0,
    sizes: 0,
  });
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchMaterialPlan(material, user?.id, Number(minAvg) || 0)
      .then((d) => {
        setPlan(d.actions);
        setBase({ margin: d.baseAvgMargin, sizes: d.sizes });
      })
      .catch(() => setPlan([]))
      .finally(() => setLoading(false));
  }, [material, minAvg, user?.id]);

  const join = async (a: PlanAction) => {
    setBusyId(a.actionId);
    try {
      const res = await joinAction({
        actionId: a.actionId,
        offerIds: a.items.filter((i) => i.eligible).map((i) => i.offerId),
        minMargin: 0,
        actorId: user?.id,
        actorName: user?.name,
      });
      toast({
        title: `Заведено в «${a.title}»`,
        description: `${res.joined} размеров`,
      });
      onDone();
    } catch (e) {
      toast({
        title: 'Не удалось завести',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Минимальная средняя маржа по ассортименту, %</Label>
        <Input
          type="number"
          step="0.5"
          value={minAvg}
          onChange={(e) => setMinAvg(e.target.value)}
          className="h-9"
        />
        <p className="text-xs text-muted-foreground">
          Скидка в одной акции терпима, но если завести материал во все разом,
          прибыль просядет до нуля. Ниже этой границы акции не предлагаются
        </p>
      </div>

      {!loading && base.sizes > 0 && (
        <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
          {material}: {base.sizes} размеров, средняя маржа сейчас{' '}
          <span className="font-medium text-foreground">{base.margin}%</span>
        </p>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Loader2" size={14} className="animate-spin" />
          Считаем все акции по всем размерам…
        </div>
      )}

      {!loading && plan.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Площадка не предлагает размеры этого материала ни в одну акцию
        </p>
      )}

      <div className="space-y-2">
        {plan.map((a, i) => (
          <div
            key={a.actionId}
            className={`rounded-md border p-2 ${
              a.recommended
                ? 'border-emerald-300 bg-emerald-50/60'
                : 'border-border bg-muted/30'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium">
                  {/* Номер очереди: с какой акции начинать. */}
                  <span className="mr-1 text-muted-foreground">{i + 1}.</span>
                  {a.title}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Проходят {a.fits} из {a.total} размеров
                  {a.newItems > 0 && ` · новых ${a.newItems}`}
                  {a.dateEnd && ` · до ${a.dateEnd}`}
                </p>
                <p
                  className={`mt-0.5 text-[11px] ${
                    a.recommended ? 'text-emerald-800' : 'text-muted-foreground'
                  }`}
                >
                  {a.reason}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs font-bold">{a.avgAfter}%</p>
                <p className="text-[11px] text-muted-foreground">
                  {/* Цена скидки: сколько прибыли отдаём с каждой вещи. */}
                  −{money(a.profitDrop)} ₽/шт
                </p>
              </div>
            </div>
            {a.recommended && a.newItems > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="mt-1.5 h-7 w-full text-xs"
                disabled={!!busyId}
                onClick={() => join(a)}
              >
                {busyId === a.actionId
                  ? 'Заводим…'
                  : `Завести ${a.fits} размеров`}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default PromotePlan;
